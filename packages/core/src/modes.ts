import { matchPath, matchPathSpecific } from "./policy.js";
import type { PathTag } from "./policy.js";
import { type GateEntry, type ModeGate, getState } from "./registry.js";
import { matchShellPart, shellPartSafety, splitShellParts } from "./shell.js";
import {
  dropSession,
  effectiveCwd,
  readPersistedMode,
  session,
  setMode,
} from "./state.js";
import type {
  Effect,
  ModeLayer,
  ModeNotice,
  Rule,
  Tag,
  Verdict,
} from "./types.js";

export type { ModeGate } from "./registry.js";

const DEFAULT_MODE = "ask";

const SEVERITY: Record<Verdict, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
};

const BUILTIN_LAYERS: ModeLayer[] = [
  {
    name: "ask",
    source: "builtin",
    defaults: { read: "allow", search: "allow", edit: "ask", shell: "ask" },
  },
  {
    name: "edit",
    source: "builtin",
    defaults: { read: "allow", search: "allow", edit: "allow", shell: "ask" },
  },
  {
    name: "plan",
    source: "builtin",
    defaults: { read: "allow", search: "allow", edit: "deny", shell: "ask" },
    overrides: [
      { tag: "edit", pattern: "artifacts/plan.md", effect: "ask" },
      { tag: "edit", pattern: "artifacts/specs.md", effect: "ask" },
      { tag: "edit", pattern: "artifacts/tasks/*", effect: "ask" },
      { tag: "edit", pattern: "*", effect: "deny" },
    ],
  },
];

export interface ModeEnterResult {
  mode: string;
  veto?: string;
  notices: ModeNotice[];
  diagnostic?: string;
}

export interface EvaluateOptions {
  owner: unknown;
  cwd: string;
  tag: Tag;
  target: string;
  rules: readonly Rule[];
}

export function registerMode(
  layer: ModeLayer,
  onDiagnostic?: (message: string) => void,
): boolean {
  const state = getState();
  if (state.layers.some((entry) => entry.layer.name === layer.name)) {
    onDiagnostic?.(`mode "${layer.name}" is already registered`);
    return false;
  }
  const source = layer.source ?? "package";
  state.layers.push({ layer, source });
  if (layer.onEnter !== undefined) {
    const onEnter = layer.onEnter;
    state.gates.push({
      layerName: layer.name,
      gate: (mode, owner) => (mode === layer.name ? onEnter(owner) : undefined),
    });
  }
  return true;
}

export function registerModeGate(gate: ModeGate, key?: string): () => void {
  const state = getState();
  if (key !== undefined) {
    // A keyed gate replaces the previous registration with that key, so a
    // reloaded extension does not leave a stale copy on the registry.
    state.gates = state.gates.filter((entry) => entry.key !== key);
  }
  const entry: GateEntry = { gate, key };
  state.gates.push(entry);
  return () => {
    const index = state.gates.indexOf(entry);
    if (index >= 0) state.gates.splice(index, 1);
  };
}

export function replaceConfigModes(
  layers: readonly ModeLayer[],
  onDiagnostic?: (message: string) => void,
): void {
  const state = getState();
  const removed = new Set(
    state.layers
      .filter((entry) => entry.source === "config")
      .map((entry) => entry.layer.name),
  );
  state.layers = state.layers.filter((entry) => entry.source !== "config");
  state.gates = state.gates.filter(
    (entry) => entry.layerName === undefined || !removed.has(entry.layerName),
  );
  for (const layer of layers) {
    registerMode({ ...layer, source: "config" }, onDiagnostic);
  }
}

export function modeLayers(): readonly ModeLayer[] {
  return getState().layers.map((entry) => entry.layer);
}

export function modeNames(): string[] {
  return getState().layers.map((entry) => entry.layer.name);
}

export function getModeLayer(name: string): ModeLayer | undefined {
  return getState().layers.find((entry) => entry.layer.name === name)?.layer;
}

function runGates(
  owner: unknown,
  mode: string,
): {
  veto?: string;
  notices: ModeNotice[];
} {
  const notices: ModeNotice[] = [];
  let veto: string | undefined;
  for (const entry of getState().gates) {
    const result = entry.gate(mode, owner);
    if (result === undefined) continue;
    if (result.notice !== undefined) notices.push(result.notice);
    if (veto === undefined && result.veto !== undefined) veto = result.veto;
  }
  return { veto, notices };
}

export function enterMode(owner: unknown, name: string): ModeEnterResult {
  if (getModeLayer(name) === undefined) {
    return {
      mode: session(owner).mode,
      notices: [],
      diagnostic: `unknown mode: ${name}`,
    };
  }
  const gates = runGates(owner, name);
  if (gates.veto !== undefined) {
    return {
      mode: session(owner).mode,
      veto: gates.veto,
      notices: gates.notices,
    };
  }
  setMode(owner, name);
  return { mode: name, notices: gates.notices };
}

export function resetSession(owner: unknown): ModeEnterResult {
  dropSession(owner);
  const stored = readPersistedMode(owner);
  if (stored === undefined || stored === DEFAULT_MODE) {
    return { mode: DEFAULT_MODE, notices: [] };
  }
  if (getModeLayer(stored) === undefined) {
    return {
      mode: DEFAULT_MODE,
      notices: [],
      diagnostic: `restored mode "${stored}" no longer exists; using ask`,
    };
  }
  const gates = runGates(owner, stored);
  if (gates.veto !== undefined) {
    return { mode: DEFAULT_MODE, veto: gates.veto, notices: gates.notices };
  }
  setMode(owner, stored, { persist: false });
  return { mode: stored, notices: gates.notices };
}

function strictest(left: Verdict, right: Verdict): Verdict {
  return SEVERITY[right] > SEVERITY[left] ? right : left;
}

function evaluatePath(
  options: EvaluateOptions,
  tag: PathTag,
  layer: ModeLayer | undefined,
  fallback: Effect,
): Verdict {
  const hard = matchPath([], options.target, tag, options.cwd);
  if (hard.outside) return "deny";

  const project = matchPath(options.rules, options.target, tag, options.cwd);
  if (project.rule?.effect === "deny") return "deny";

  const tagOverrides = (layer?.overrides ?? []).filter(
    (rule) => rule.tag === tag && rule.effect !== "allow",
  );
  const override = matchPathSpecific(
    tagOverrides,
    options.target,
    tag,
    effectiveCwd(options.cwd, options.owner),
  );
  if (!override.outside && override.rule !== undefined) {
    return override.rule.effect;
  }
  if (override.outside && tagOverrides.length > 0) {
    // The target escapes the effective cwd, so the layer's own patterns do
    // not describe it: the layer default decides instead of a project rule.
    // A project rule may still tighten that default, never loosen it.
    const projectEffect = project.rule?.effect;
    return projectEffect === undefined
      ? fallback
      : strictest(fallback, projectEffect);
  }

  if (project.rule !== undefined) return project.rule.effect;
  return fallback;
}

function evaluateShell(
  options: EvaluateOptions,
  layer: ModeLayer | undefined,
  fallback: Effect,
): Verdict {
  const parts = splitShellParts(options.target);
  if (parts.length === 0) return "deny";

  const overrides = (layer?.overrides ?? []).filter(
    (rule) => rule.tag === "shell" && rule.effect !== "allow",
  );
  let verdict: Verdict = "allow";
  for (const part of parts) {
    if (shellPartSafety(part) !== undefined) return "deny";
    const project = matchShellPart(part, options.rules);
    if (project === "deny") return "deny";
    const override = matchShellPart(part, overrides);
    const partVerdict = override ?? project ?? fallback;
    if (partVerdict === "deny") return "deny";
    verdict = strictest(verdict, partVerdict);
  }
  return verdict;
}

export function evaluate(options: EvaluateOptions): Verdict {
  const active = getModeLayer(session(options.owner).mode);
  const layer = active ?? getModeLayer(DEFAULT_MODE);
  const fallback = layer?.defaults[options.tag] ?? "ask";
  if (options.tag === "shell") return evaluateShell(options, layer, fallback);
  return evaluatePath(options, options.tag, layer, fallback);
}

for (const layer of BUILTIN_LAYERS) registerMode(layer);
