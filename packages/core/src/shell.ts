import { homedir } from "node:os";
import { basename } from "node:path";
import type { Rule, Verdict } from "./types.js";

const DANGEROUS = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "fish",
  "eval",
  "xargs",
  "env",
  "sudo",
  "tee",
  "dd",
  "awk",
  "perl",
  "python",
  "node",
]);

const WRAPPERS = new Set(["timeout", "nohup", "command", "env"]);

const SEVERITY: Record<"allow" | "ask", number> = {
  allow: 0,
  ask: 1,
};

export interface ShellVerdict {
  decision: Verdict;
  reason?: string;
}

export interface ShellPart {
  text: string;
  name: string;
  rest: string;
}

function short(part: string): string {
  return part.length > 200 ? `${part.slice(0, 200)}…` : part;
}

const SAFE_REDIRECT_RE =
  /(?:^|(?<=\s))(?:\d*>[&](?:\d+|-)|\d*<&(?:\d+|-)|(?:\d+|&)?>>?\s*\/dev\/null|\d*<\s*\/dev\/null)(?=\s|$)/g;

function stripSafeRedirects(text: string): string {
  return text.replace(SAFE_REDIRECT_RE, " ").replace(/\s+/g, " ").trim();
}

function dequote(token: string): string {
  let out = "";
  let index = 0;
  let quote: string | undefined;
  while (index < token.length) {
    const char = token[index] ?? "";
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      } else if (char === "\\" && quote === '"' && index + 1 < token.length) {
        out += token[index + 1] ?? "";
        index += 1;
      } else {
        out += char;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "\\" && index + 1 < token.length) {
      index += 1;
      out += token[index] ?? "";
    } else {
      out += char;
    }
    index += 1;
  }
  return out;
}

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean).map(dequote);
}

export function splitShellParts(command: string): ShellPart[] {
  return command
    .split(/&&|\|\||[;|\n]|(?<![<>])&(?!>)/)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((text) => {
      const cleaned = stripSafeRedirects(text);
      const [name, ...rest] = tokenize(cleaned || text);
      return { text, name: basename(name ?? ""), rest: rest.join(" ") };
    });
}

function unwrapTokens(tokens: readonly string[]): {
  tokens: string[];
  wrapped: boolean;
} {
  const current = [...tokens];
  let wrapped = false;

  while (current.length > 0) {
    if (
      current.length > 1 &&
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(current[0] ?? "")
    ) {
      wrapped = true;
      current.shift();
      continue;
    }
    const head = basename(dequote(current[0] ?? ""));
    if (head === "nohup") {
      wrapped = true;
      current.shift();
      while (current[0]?.startsWith("-")) {
        current.shift();
      }
      continue;
    }
    if (head === "command") {
      if (current[1] === "-v" || current[1] === "-V") break;
      wrapped = true;
      current.shift();
      while (current[0]?.startsWith("-")) {
        current.shift();
      }
      continue;
    }
    if (head === "env") {
      wrapped = true;
      current.shift();
      while (current.length > 0) {
        const tok = dequote(current[0] ?? "");
        if (
          tok === "-u" ||
          tok === "--unset" ||
          tok === "-C" ||
          tok === "--chdir" ||
          tok === "-S" ||
          tok === "--split-string"
        ) {
          current.shift();
          current.shift();
          continue;
        }
        if (tok.startsWith("-") || tok.includes("=")) {
          current.shift();
          continue;
        }
        break;
      }
      continue;
    }
    if (head === "timeout") {
      wrapped = true;
      current.shift();
      while (current.length > 0) {
        const tok = dequote(current[0] ?? "");
        if (
          tok === "-k" ||
          tok === "--kill-after" ||
          tok === "-s" ||
          tok === "--signal"
        ) {
          current.shift();
          current.shift();
          continue;
        }
        if (tok.startsWith("-")) {
          current.shift();
          continue;
        }
        break;
      }
      if (current.length > 0) {
        current.shift();
      }
      continue;
    }
    break;
  }

  return { tokens: current, wrapped };
}

const SYSTEM_TARGETS = new Set([
  "bin",
  "boot",
  "dev",
  "etc",
  "lib",
  "lib32",
  "lib64",
  "libx32",
  "opt",
  "proc",
  "root",
  "sbin",
  "srv",
  "sys",
  "usr",
  "var",
]);

function isProtectedTarget(rawTarget: string): boolean {
  const target = dequote(rawTarget);
  if (target === "") return false;
  const stripped = target.replace(/\/+$/, "");
  const home = homedir().replace(/\/+$/, "");
  if (
    stripped === "" ||
    target === "/*" ||
    target === "~" ||
    target.startsWith("~/") ||
    target === "$HOME" ||
    target.startsWith("$HOME/") ||
    target === "${HOME}" ||
    target.startsWith("${HOME}/") ||
    (home !== "" && (stripped === home || target.startsWith(`${home}/`)))
  ) {
    return true;
  }
  if (!stripped.startsWith("/")) return false;
  const [head] = stripped.replace(/^\/+/, "").split("/");
  return head !== undefined && SYSTEM_TARGETS.has(head);
}

function detectDestructiveTokens(
  rawTokens: readonly string[],
): string | undefined {
  const { tokens } = unwrapTokens(rawTokens);
  if (tokens.length === 0) return undefined;
  const name = basename(dequote(tokens[0] ?? ""));
  const args = tokens.slice(1);

  if (name === "rm") {
    let recursive = false;
    let endOfOptions = false;
    const targets: string[] = [];
    for (const arg of args) {
      if (!endOfOptions && arg === "--") {
        endOfOptions = true;
        continue;
      }
      if (!endOfOptions && arg.startsWith("--")) {
        if (arg === "--recursive") recursive = true;
        continue;
      }
      if (!endOfOptions && arg.startsWith("-") && arg.length > 1) {
        if (/[rR]/.test(arg)) recursive = true;
        continue;
      }
      targets.push(arg);
    }
    if (recursive && targets.some(isProtectedTarget)) {
      return `destructive command "${short(tokens.join(" "))}"`;
    }
  }

  if (name === "find") {
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === "-delete") {
        return `destructive command "${short(tokens.join(" "))}"`;
      }
      if (
        arg === "-exec" ||
        arg === "-execdir" ||
        arg === "-ok" ||
        arg === "-okdir"
      ) {
        const execCmd = basename(dequote(args[i + 1] ?? ""));
        if (execCmd === "rm") {
          return `destructive command "${short(tokens.join(" "))}"`;
        }
      }
    }
  }

  if (name === "git") {
    let subIndex = 0;
    while (subIndex < args.length) {
      const arg = args[subIndex] ?? "";
      if (
        arg === "-C" ||
        arg === "-c" ||
        arg === "--git-dir" ||
        arg === "--work-tree" ||
        arg === "--namespace"
      ) {
        subIndex += 2;
        continue;
      }
      if (arg.startsWith("-")) {
        subIndex += 1;
        continue;
      }
      break;
    }
    if (args[subIndex] === "push") {
      for (let i = subIndex + 1; i < args.length; i += 1) {
        const arg = args[i] ?? "";
        if (
          arg === "--force" ||
          arg === "-f" ||
          arg === "--force-with-lease" ||
          arg.startsWith("--force-with-lease=") ||
          arg === "--force-if-includes" ||
          (arg.startsWith("-") && !arg.startsWith("--") && arg.includes("f")) ||
          (arg.startsWith("+") && arg.length > 1)
        ) {
          return `destructive command "${short(tokens.join(" "))}"`;
        }
      }
    }
  }

  return undefined;
}

export function shellPartDestructive(part: ShellPart): string | undefined {
  const tokens = tokenize(stripSafeRedirects(part.text));
  return detectDestructiveTokens(tokens);
}

function ruleMatches(rule: Rule, name: string, rest: string): boolean {
  const [ruleName, ...ruleRest] = tokenize(rule.pattern.trim());
  if ((ruleName === "*" || ruleName === "**") && name !== "") return true;
  if (basename(ruleName ?? "") !== name || name === "") return false;
  const prefix = ruleRest.join(" ");
  if (prefix === "") return true;
  return (
    rest === prefix ||
    rest.startsWith(`${prefix} `) ||
    rest.startsWith(`${prefix}/`)
  );
}

export function shellPartSafety(part: ShellPart): string | undefined {
  const withoutSafeRedirects = stripSafeRedirects(part.text);
  const tokens = tokenize(withoutSafeRedirects);
  const { tokens: unwrapped } = unwrapTokens(tokens);
  const unwrappedName = basename(unwrapped[0] ?? "");
  const isDestructive = detectDestructiveTokens(tokens) !== undefined;

  if (!isDestructive && DANGEROUS.has(part.name)) {
    return `dangerous command "${part.name}"`;
  }
  if (unwrappedName !== "" && DANGEROUS.has(unwrappedName)) {
    return `dangerous command "${unwrappedName}"`;
  }
  if (part.text.includes("<(") || part.text.includes(">(")) {
    return `process substitution in "${short(part.text)}"`;
  }
  if (
    withoutSafeRedirects === "" ||
    withoutSafeRedirects.includes(">") ||
    withoutSafeRedirects.includes("<")
  ) {
    return `redirect in "${short(part.text)}"`;
  }
  if (part.text.includes("$(") || part.text.includes("`")) {
    return `command substitution in "${short(part.text)}"`;
  }
  return undefined;
}

export function matchShellPart(
  part: ShellPart,
  rules: readonly Rule[],
): Verdict | undefined {
  const tokens = tokenize(stripSafeRedirects(part.text));
  const { tokens: unwrapped, wrapped } = unwrapTokens(tokens);
  const unwrappedName = basename(unwrapped[0] ?? "");
  const unwrappedRest = unwrapped.slice(1).join(" ");
  const isDestructive = detectDestructiveTokens(tokens) !== undefined;

  let best: Rule | undefined;
  for (const rule of rules) {
    if (rule.tag !== "shell") continue;
    const ruleTokens = tokenize(rule.pattern.trim());
    const ruleHead = basename(ruleTokens[0] ?? "");
    const directMatch = ruleMatches(rule, part.name, part.rest);
    const unwrappedMatch =
      wrapped &&
      unwrappedName !== "" &&
      ruleMatches(rule, unwrappedName, unwrappedRest);

    if (!directMatch && !unwrappedMatch) continue;
    if (rule.effect === "deny") return "deny";

    if (
      rule.effect === "allow" &&
      WRAPPERS.has(ruleHead) &&
      ruleTokens.length === 1
    ) {
      continue;
    }

    if (
      isDestructive &&
      rule.effect === "allow" &&
      detectDestructiveTokens(ruleTokens) === undefined
    ) {
      continue;
    }

    if (
      best === undefined ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length &&
        SEVERITY[rule.effect] > SEVERITY[best.effect as "allow" | "ask"])
    ) {
      best = rule;
    }
  }
  return best?.effect;
}

export function checkShell(
  command: string,
  rules: readonly Rule[],
): ShellVerdict {
  const parts = splitShellParts(command);
  if (parts.length === 0) {
    return { decision: "deny", reason: "empty command" };
  }
  const relevant = rules.filter((rule) => rule.tag === "shell");
  let askReason: string | undefined;

  for (const part of parts) {
    const safety = shellPartSafety(part);
    if (safety !== undefined) return { decision: "deny", reason: safety };

    const destructive = shellPartDestructive(part);
    const matched = matchShellPart(part, relevant);
    if (matched === "deny") {
      return {
        decision: "deny",
        reason: `denied by rule for "${part.name}"`,
      };
    }
    if (destructive !== undefined && matched !== "allow") {
      askReason ??= destructive;
      continue;
    }
    if (matched === "ask") {
      askReason ??= `ask rule for "${part.name}"`;
    } else if (matched === undefined) {
      askReason ??= `no allow rule for "${part.name}"`;
    }
  }

  if (askReason !== undefined) return { decision: "ask", reason: askReason };
  return { decision: "allow" };
}
