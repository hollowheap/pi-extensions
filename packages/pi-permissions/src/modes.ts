import { relative, resolve, sep } from "node:path";
import type { Tag, Verdict } from "./rules.js";

// TODO(provisional names): plan, ask, allow-edits, autopilot.
export type Mode = "plan" | "ask" | "allow-edits" | "autopilot";

const MODES: ReadonlySet<string> = new Set([
  "plan",
  "ask",
  "allow-edits",
  "autopilot",
]);

export function isMode(value: string): value is Mode {
  return MODES.has(value);
}

export const PLAN_PATHS: readonly string[] = [
  "artifacts/plan.md",
  "artifacts/specs.md",
];

export function planRules(): { tag: Tag; pattern: string; effect: "allow" }[] {
  return PLAN_PATHS.map((pattern) => ({
    tag: "edit",
    pattern,
    effect: "allow",
  }));
}

export function isPlanPath(path: string, root: string): boolean {
  const rel = relative(root, resolve(root, path)).split(sep).join("/");
  return (PLAN_PATHS as readonly string[]).includes(rel);
}

export function applyMode(
  mode: Mode,
  tag: Tag,
  verdict: Verdict,
  inPlanPaths: boolean,
): Verdict {
  if (verdict === "deny") return "deny";
  if (tag === "edit" && inPlanPaths) return "ask";
  switch (mode) {
    case "ask":
      return verdict;
    case "allow-edits":
      if (tag === "edit") return verdict;
      if (tag === "shell") return "ask";
      return verdict;
    case "autopilot":
      if (tag === "edit" || tag === "shell") return "allow";
      return verdict;
    case "plan":
      if (tag === "shell") return verdict === "allow" ? "ask" : "deny";
      if (tag === "edit") return inPlanPaths ? "ask" : "deny";
      return verdict;
  }
}

const modeOwners = new Map<unknown, Mode>();
const tokenCaps = new Map<unknown, number>();

export function getMode(owner: unknown): Mode {
  return modeOwners.get(owner) ?? "ask";
}

export function setMode(owner: unknown, mode: Mode): void {
  modeOwners.set(owner, mode);
}

export function clearMode(owner: unknown): void {
  modeOwners.delete(owner);
  tokenCaps.delete(owner);
}

export function getTokenCap(owner: unknown): number | undefined {
  return tokenCaps.get(owner);
}

export function setTokenCap(owner: unknown, cap: number): void {
  tokenCaps.set(owner, cap);
}
