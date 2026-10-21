import { relative, resolve, sep } from "node:path";
import type {
  ModeApplyDetails,
  ModeDefinition,
  Tag,
  Verdict,
} from "@hollowheap/core";

function passthrough(_tag: Tag, verdict: Verdict): Verdict {
  return verdict;
}

function planPolicy(tag: Tag, verdict: Verdict): Verdict {
  if (tag === "edit") return "deny";
  if (tag === "shell") return verdict === "allow" ? "allow" : "deny";
  return verdict;
}

function editPolicy(tag: Tag, verdict: Verdict): Verdict {
  if (tag === "shell") return verdict === "allow" ? "allow" : "deny";
  return "allow";
}

const BUILTIN_MODES: ModeDefinition[] = [
  { name: "plan", apply: (tag, verdict) => planPolicy(tag, verdict) },
  { name: "ask", apply: (tag, verdict) => passthrough(tag, verdict) },
  { name: "edit", apply: (tag, verdict) => editPolicy(tag, verdict) },
];

export function builtinModes(): ModeDefinition[] {
  return [...BUILTIN_MODES];
}

export function applyPolicy(
  modes: ModeDefinition[],
  mode: string,
  tag: Tag,
  verdict: Verdict,
  details: ModeApplyDetails,
): Verdict {
  if (verdict === "deny") return "deny";
  if (tag === "edit" && details.inPlanPaths) return "ask";
  const entry = modes.find((candidate) => candidate.name === mode);
  if (entry === undefined) return verdict;
  return entry.apply(tag, verdict, details);
}

const modeOwners = new Map<unknown, string>();

export function getMode(owner: unknown): string {
  return modeOwners.get(owner) ?? "ask";
}

export function setMode(owner: unknown, mode: string): void {
  modeOwners.set(owner, mode);
}

export function clearMode(owner: unknown): void {
  modeOwners.delete(owner);
}

const overrideDirs = new Map<unknown, string>();

export function setCwdOverride(owner: unknown, dir: string | undefined): void {
  if (dir === undefined) overrideDirs.delete(owner);
  else overrideDirs.set(owner, dir);
}

export function clearCwdOverride(owner: unknown): void {
  overrideDirs.delete(owner);
}

export function getCwdOverride(owner: unknown): string | undefined {
  return overrideDirs.get(owner);
}

export function effectiveCwd(cwd: string, owner: unknown): string {
  return overrideDirs.get(owner) ?? cwd;
}

export const PLAN_PATHS: readonly string[] = [
  "artifacts/plan.md",
  "artifacts/specs.md",
];

export const PLAN_DIRS: readonly string[] = ["artifacts/tasks"];

export function planRules(): { tag: Tag; pattern: string; effect: "allow" }[] {
  return [...PLAN_PATHS, ...PLAN_DIRS.map((dir) => `${dir}/*`)].map(
    (pattern) => ({
      tag: "edit",
      pattern,
      effect: "allow",
    }),
  );
}

export function isPlanPath(path: string, root: string): boolean {
  const rel = relative(root, resolve(root, path)).split(sep).join("/");
  if ((PLAN_PATHS as readonly string[]).includes(rel)) return true;
  return PLAN_DIRS.some((dir) => rel.startsWith(`${dir}/`));
}
