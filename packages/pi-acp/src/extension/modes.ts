import { relative, resolve, sep } from "node:path";
import type { Tag, Verdict } from "./rules.js";

export type Mode = "plan" | "ask" | "edit";
export const MODES: Mode[] = ["plan", "ask", "edit"];

export type Decision = "allow" | "deny" | "ask";

export const PLAN_PATHS: readonly string[] = [
  "artifacts/plan.md",
  "artifacts/specs.md",
];

export const PLAN_DIRS: readonly string[] = ["artifacts/tasks"];

export function isPlanPath(path: string, root: string): boolean {
  const rel = relative(root, resolve(root, path)).split(sep).join("/");
  if ((PLAN_PATHS as readonly string[]).includes(rel)) return true;
  return PLAN_DIRS.some((dir) => rel.startsWith(`${dir}/`));
}

export function decide(
  mode: Mode,
  tag: Tag,
  verdict: Verdict,
  inPlanPaths: boolean,
): Decision {
  if (verdict === "deny") return "deny";
  if (tag === "edit" && inPlanPaths) return "ask";
  if (mode === "ask") return verdict;
  if (tag === "shell") return verdict === "allow" ? "allow" : "deny";
  if (tag === "read" || tag === "search") {
    return mode === "plan" ? verdict : "allow";
  }
  if (mode === "plan") return "deny";
  return "allow";
}
