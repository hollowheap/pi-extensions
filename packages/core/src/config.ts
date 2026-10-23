import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getModeLayer } from "./modes.js";
import type { Effect, ModeLayer, Rule, Tag } from "./types.js";

const KNOWN_TAGS: readonly string[] = ["edit", "read", "search", "shell"];

const CACHE_KEY = Symbol.for("@hollowheap/core/config");
const MAX_CACHE_ENTRIES = 64;

interface PermissionsEntry {
  kind: "permissions";
  agentMtimeMs: number;
  overlayMtimeMs: number;
  rules: readonly Rule[];
  diagnostics: readonly string[];
  reported: boolean;
}

interface ModesEntry {
  kind: "modes";
  mtimeMs: number;
  layers: readonly ModeLayer[];
  diagnostics: readonly string[];
  reported: boolean;
}

type CacheEntry = PermissionsEntry | ModesEntry;

type ConfigCache = Map<string, CacheEntry>;

function getCache(): ConfigCache {
  const store = globalThis as unknown as Record<
    symbol,
    ConfigCache | undefined
  >;
  const existing = store[CACHE_KEY];
  if (existing !== undefined) return existing;
  const created: ConfigCache = new Map();
  store[CACHE_KEY] = created;
  return created;
}

const CACHE = getCache();

export interface LoadPermissionsOptions {
  agentDir: string;
  workspaceRoot: string;
  trusted: boolean;
  onDiagnostic?: (message: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
}

function buildRule(
  effect: unknown,
  tag: unknown,
  pattern: unknown,
  diagnostics: string[],
): Rule | undefined {
  if (
    (effect === "allow" || effect === "ask" || effect === "deny") &&
    typeof tag === "string" &&
    KNOWN_TAGS.includes(tag) &&
    typeof pattern === "string" &&
    pattern !== ""
  ) {
    return Object.freeze({ effect, tag: tag as Tag, pattern });
  }
  diagnostics.push(
    'ignoring rule: need "allow|ask|deny <tag> <pattern>" (edit, read, search, shell)',
  );
  return undefined;
}

function parseRuleEntry(
  entry: unknown,
  diagnostics: string[],
): Rule | undefined {
  if (typeof entry === "string") {
    const [effect, tag, ...rest] = entry.trim().split(/\s+/);
    return buildRule(effect, tag, rest.join(" "), diagnostics);
  }
  if (isRecord(entry)) {
    return buildRule(entry.effect, entry.tag, entry.pattern, diagnostics);
  }
  diagnostics.push("ignoring rule: must be an object or a string");
  return undefined;
}

function parseRulesFile(
  content: string,
  path: string,
  diagnostics: string[],
): Rule[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    diagnostics.push(`permissions file is not valid JSON: ${path}`);
    return [];
  }
  const entries =
    isRecord(parsed) && Array.isArray(parsed.rules)
      ? parsed.rules
      : Array.isArray(parsed)
        ? parsed
        : undefined;
  if (entries === undefined) {
    diagnostics.push(
      `permissions file must be {"rules": [...]} or [...]: ${path}`,
    );
    return [];
  }
  const rules: Rule[] = [];
  for (const entry of entries) {
    const rule = parseRuleEntry(entry, diagnostics);
    if (rule !== undefined) rules.push(rule);
  }
  return rules;
}

function readRules(path: string, mtime: number, diagnostics: string[]): Rule[] {
  if (mtime < 0) return [];
  try {
    return parseRulesFile(readFileSync(path, "utf8"), path, diagnostics);
  } catch {
    diagnostics.push(`cannot read permissions file: ${path}`);
    return [];
  }
}

function report(entry: CacheEntry, onDiagnostic?: (message: string) => void) {
  if (
    entry.reported ||
    entry.diagnostics.length === 0 ||
    onDiagnostic === undefined
  ) {
    return;
  }
  entry.reported = true;
  for (const diagnostic of entry.diagnostics) onDiagnostic(diagnostic);
}

function store(key: string, entry: CacheEntry): void {
  CACHE.set(key, entry);
  if (CACHE.size > MAX_CACHE_ENTRIES) {
    const oldest = CACHE.keys().next().value;
    if (oldest !== undefined) CACHE.delete(oldest);
  }
}

export function loadPermissions(options: LoadPermissionsOptions): Rule[] {
  const agentPath = join(options.agentDir, "permissions.json");
  const overlayPath = join(options.workspaceRoot, ".pi", "permissions.json");
  const agentMtime = mtimeMs(agentPath);
  const overlayMtime = mtimeMs(overlayPath);
  const key = `${agentPath}\0${overlayPath}\0${options.trusted ? "1" : "0"}`;

  const cached = CACHE.get(key);
  if (
    cached !== undefined &&
    cached.kind === "permissions" &&
    cached.agentMtimeMs === agentMtime &&
    cached.overlayMtimeMs === overlayMtime
  ) {
    report(cached, options.onDiagnostic);
    return [...cached.rules];
  }

  const diagnostics: string[] = [];
  const rules = readRules(agentPath, agentMtime, diagnostics);
  if (options.trusted) {
    rules.push(...readRules(overlayPath, overlayMtime, diagnostics));
  } else if (overlayMtime >= 0) {
    diagnostics.push("ignoring .pi/permissions.json: project is not trusted");
  }

  const entry: PermissionsEntry = {
    kind: "permissions",
    agentMtimeMs: agentMtime,
    overlayMtimeMs: overlayMtime,
    rules: Object.freeze(rules),
    diagnostics: Object.freeze(diagnostics),
    reported: false,
  };
  store(key, entry);
  report(entry, options.onDiagnostic);
  return [...rules];
}

function parseModeDefaults(
  name: string,
  value: unknown,
  diagnostics: string[],
): Record<Tag, Effect> | undefined {
  if (!isRecord(value)) {
    diagnostics.push(
      `ignoring mode layer "${name}": "defaults" must be an object`,
    );
    return undefined;
  }
  const defaults = {} as Record<Tag, Effect>;
  for (const tag of KNOWN_TAGS) {
    const effect = value[tag];
    if (effect === undefined) {
      diagnostics.push(
        `ignoring mode layer "${name}": missing default for "${tag}"`,
      );
      return undefined;
    }
    if (effect !== "allow" && effect !== "ask" && effect !== "deny") {
      diagnostics.push(
        `ignoring mode layer "${name}": invalid effect for "${tag}"`,
      );
      return undefined;
    }
    defaults[tag as Tag] = effect;
  }
  return defaults;
}

function parseModeOverride(
  name: string,
  entry: unknown,
  diagnostics: string[],
): Rule | undefined {
  let effect: unknown;
  let tag: unknown;
  let pattern: unknown;
  if (typeof entry === "string") {
    const [parsedEffect, parsedTag, ...rest] = entry.trim().split(/\s+/);
    effect = parsedEffect;
    tag = parsedTag;
    pattern = rest.join(" ");
  } else if (isRecord(entry)) {
    effect = entry.effect;
    tag = entry.tag;
    pattern = entry.pattern;
  } else {
    diagnostics.push(
      `ignoring mode override in "${name}": must be an object or a string`,
    );
    return undefined;
  }
  if (effect === "allow") {
    diagnostics.push(
      `ignoring mode override in "${name}": overrides must be "ask" or "deny"`,
    );
    return undefined;
  }
  if (
    (effect !== "ask" && effect !== "deny") ||
    typeof tag !== "string" ||
    !KNOWN_TAGS.includes(tag) ||
    typeof pattern !== "string" ||
    pattern === ""
  ) {
    diagnostics.push(
      `ignoring mode override in "${name}": need "ask|deny <tag> <pattern>"`,
    );
    return undefined;
  }
  return { effect, tag: tag as Tag, pattern };
}

function parseModeLayer(
  name: string,
  value: unknown,
  diagnostics: string[],
): ModeLayer | undefined {
  if (!isRecord(value)) {
    diagnostics.push(`ignoring mode layer "${name}": must be an object`);
    return undefined;
  }
  const defaults = parseModeDefaults(name, value.defaults, diagnostics);
  if (defaults === undefined) return undefined;
  const overrides: Rule[] = [];
  if (value.overrides !== undefined) {
    if (!Array.isArray(value.overrides)) {
      diagnostics.push(
        `ignoring mode layer "${name}": "overrides" must be an array`,
      );
      return undefined;
    }
    for (const entry of value.overrides) {
      const rule = parseModeOverride(name, entry, diagnostics);
      if (rule !== undefined) overrides.push(rule);
    }
  }
  return Object.freeze({
    name,
    defaults: Object.freeze(defaults),
    overrides: Object.freeze(overrides),
    source: "config" as const,
  });
}

function readModesFile(
  path: string,
  mtime: number,
  diagnostics: string[],
): ModeLayer[] {
  if (mtime < 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    diagnostics.push(`modes file is not valid JSON: ${path}`);
    return [];
  }
  if (!isRecord(parsed) || !isRecord(parsed.modes)) {
    diagnostics.push(`modes file must be {"modes": {...}}: ${path}`);
    return [];
  }
  const layers: ModeLayer[] = [];
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(parsed.modes)) {
    if (name === "") {
      diagnostics.push("ignoring mode layer: name must not be empty");
      continue;
    }
    if (seen.has(name)) {
      diagnostics.push(`ignoring duplicate mode layer "${name}"`);
      continue;
    }
    seen.add(name);
    const layer = parseModeLayer(name, value, diagnostics);
    if (layer === undefined) continue;
    const existing = getModeLayer(name);
    if (existing !== undefined && existing.source !== "config") {
      diagnostics.push(
        `ignoring mode layer "${name}": name is already registered`,
      );
      continue;
    }
    layers.push(layer);
  }
  return layers;
}

export function loadModesConfig(
  agentDir: string,
  onDiagnostic?: (message: string) => void,
): ModeLayer[] {
  const agentPath = join(agentDir, "modes.json");
  const mtime = mtimeMs(agentPath);
  const key = `modes\0${agentPath}`;

  const cached = CACHE.get(key);
  if (
    cached !== undefined &&
    cached.kind === "modes" &&
    cached.mtimeMs === mtime
  ) {
    report(cached, onDiagnostic);
    return [...cached.layers];
  }

  const diagnostics: string[] = [];
  const layers = readModesFile(agentPath, mtime, diagnostics);
  const entry: ModesEntry = {
    kind: "modes",
    mtimeMs: mtime,
    layers: Object.freeze(layers),
    diagnostics: Object.freeze(diagnostics),
    reported: false,
  };
  store(key, entry);
  report(entry, onDiagnostic);
  return [...layers];
}
