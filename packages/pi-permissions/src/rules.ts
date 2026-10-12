import { realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export type Verb = "read" | "write";
export type Effect = "allow" | "deny";

export interface Rule {
  verb: Verb;
  pattern: string;
  effect: Effect;
}

const REGEX_SPECIAL = new Set([
  ".",
  "+",
  "^",
  "$",
  "{",
  "}",
  "(",
  ")",
  "|",
  "[",
  "]",
  "\\",
]);

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (const char of pattern) {
    if (char === "*") source += ".*";
    else if (char === "?") source += ".";
    else if (REGEX_SPECIAL.has(char)) source += `\\${char}`;
    else source += char;
  }
  return new RegExp(`^${source}$`);
}

function specificity(pattern: string): number {
  return pattern.replace(/[*?]/g, "").length;
}

function tryRealpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function realpathLoose(abs: string): string {
  const direct = tryRealpath(abs);
  if (direct !== undefined) return direct;
  const missing: string[] = [];
  let cur = abs;
  while (cur !== dirname(cur)) {
    missing.unshift(basename(cur));
    cur = dirname(cur);
    const base = tryRealpath(cur);
    if (base !== undefined) return join(base, ...missing);
  }
  return abs;
}

export function check(
  rules: Rule[],
  path: string,
  verb: Verb,
  root: string,
): Effect {
  let realRoot = root;
  try {
    realRoot = realpathSync(root);
  } catch {
    realRoot = root;
  }
  const actual = realpathLoose(resolve(root, path));
  const rel = relative(realRoot, actual);
  if (rel === ".." || rel.startsWith(`..${sep}`)) return "deny";
  const posix = rel.split(sep).join("/");
  let winner: Rule | undefined;
  for (const rule of rules) {
    if (rule.verb !== verb) continue;
    if (!globToRegExp(rule.pattern).test(posix)) continue;
    winner = rule;
  }
  if (winner === undefined) return "deny";
  if (winner.effect === "deny") return "deny";
  const winnerSpecificity = specificity(winner.pattern);
  // TODO(provisional): a deny tied on specificity with the winning allow still denies.
  for (const rule of rules) {
    if (rule === winner) continue;
    if (rule.verb !== verb) continue;
    if (rule.effect !== "deny") continue;
    if (!globToRegExp(rule.pattern).test(posix)) continue;
    if (specificity(rule.pattern) === winnerSpecificity) return "deny";
  }
  return "allow";
}
