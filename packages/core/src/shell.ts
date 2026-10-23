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

export function splitShellParts(command: string): ShellPart[] {
  return command
    .split(/\s*(?:&&|\|\||[;|&\n])\s*/)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((text) => {
      const [name, ...rest] = text.split(/\s+/);
      return { text, name: basename(name ?? ""), rest: rest.join(" ") };
    });
}

function ruleMatches(rule: Rule, name: string, rest: string): boolean {
  const [ruleName, ...ruleRest] = rule.pattern.trim().split(/\s+/);
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
  if (DANGEROUS.has(part.name)) {
    return `dangerous command "${part.name}"`;
  }
  if (part.text.includes("<(") || part.text.includes(">(")) {
    return `process substitution in "${short(part.text)}"`;
  }
  if (part.text.includes(">") || part.text.includes("<")) {
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
  let best: Rule | undefined;
  for (const rule of rules) {
    if (rule.tag !== "shell") continue;
    if (!ruleMatches(rule, part.name, part.rest)) continue;
    if (rule.effect === "deny") return "deny";
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

    const matched = matchShellPart(part, relevant);
    if (matched === "deny") {
      return {
        decision: "deny",
        reason: `denied by rule for "${part.name}"`,
      };
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
