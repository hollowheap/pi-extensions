import { readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Rule, Tag, Verdict } from "./types.js";

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

const SEVERITY: Record<Verdict, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
};

const MAX_SYMLINK_HOPS = 40;

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

function resolveReal(root: string, path: string): string | undefined {
  const absolute = isAbsolute(path)
    ? path
    : root.endsWith(sep)
      ? `${root}${path}`
      : `${root}${sep}${path}`;
  const queue = absolute.split(sep).filter((part) => part !== "");
  let current: string = sep;
  let hops = 0;

  while (queue.length > 0) {
    const part = queue.shift();
    if (part === undefined) break;
    if (part === ".") continue;
    if (part === "..") {
      current = dirname(current);
      continue;
    }
    const next = join(current, part);
    let target: string | undefined;
    try {
      target = readlinkSync(next);
    } catch {
      target = undefined;
    }
    if (target === undefined) {
      current = next;
      continue;
    }
    if (++hops > MAX_SYMLINK_HOPS) return undefined;
    if (isAbsolute(target)) current = sep;
    queue.unshift(...target.split(sep).filter((segment) => segment !== ""));
  }
  return current;
}

export type PathTag = Exclude<Tag, "shell">;

export interface PathMatch {
  outside: boolean;
  rule?: Rule;
}

export function matchPath(
  rules: readonly Rule[],
  path: string,
  tag: PathTag,
  root: string,
): PathMatch {
  return resolveMatches(rules, path, tag, root, true);
}

export function matchPathSpecific(
  rules: readonly Rule[],
  path: string,
  tag: PathTag,
  root: string,
): PathMatch {
  return resolveMatches(rules, path, tag, root, false);
}

function resolveMatches(
  rules: readonly Rule[],
  path: string,
  tag: PathTag,
  root: string,
  denyFirst: boolean,
): PathMatch {
  const base = resolve(root);
  const realRoot = tryRealpath(base) ?? base;
  const actual = resolveReal(base, path);
  if (actual === undefined) return { outside: true };
  const rel = relative(realRoot, actual);
  if (rel === ".." || rel.startsWith(`..${sep}`)) return { outside: true };
  const posix = rel.split(sep).join("/");

  let deny: Rule | undefined;
  let best: Rule | undefined;
  let bestSpecificity = -1;
  for (const rule of rules) {
    if (rule.tag !== tag) continue;
    if (!globToRegExp(rule.pattern).test(posix)) continue;
    const ruleSpecificity = specificity(rule.pattern);
    if (rule.effect === "deny" && denyFirst) {
      if (deny === undefined || ruleSpecificity > specificity(deny.pattern)) {
        deny = rule;
      }
      continue;
    }
    if (ruleSpecificity > bestSpecificity) {
      best = rule;
      bestSpecificity = ruleSpecificity;
    } else if (
      ruleSpecificity === bestSpecificity &&
      best !== undefined &&
      SEVERITY[rule.effect] > SEVERITY[best.effect]
    ) {
      best = rule;
    }
  }
  if (denyFirst) {
    return deny === undefined
      ? { outside: false, rule: best }
      : { outside: false, rule: deny };
  }
  return { outside: false, rule: best };
}

export function checkPath(
  rules: readonly Rule[],
  path: string,
  tag: PathTag,
  root: string,
): Verdict {
  const match = matchPath(rules, path, tag, root);
  if (match.outside) return "deny";
  return match.rule?.effect ?? "ask";
}
