import { basename } from "node:path";
import type { Rule } from "./rules.js";

const DANGEROUS = new Set([
  "sh",
  "bash",
  "zsh",
  "eval",
  "xargs",
  "env",
  "sudo",
  "tee",
  "dd",
]);

export interface BashVerdict {
  allowed: boolean;
  reason?: string;
}

function short(part: string): string {
  return part.length > 200 ? `${part.slice(0, 200)}…` : part;
}

function splitParts(command: string): string[] {
  return command
    .split(/\s*(?:&&|\|\||[;|])\s*/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function ruleMatches(rule: Rule, name: string, rest: string): boolean {
  const [ruleName, ...ruleRest] = rule.pattern.trim().split(/\s+/);
  if (basename(ruleName ?? "") !== name || name === "") return false;
  const prefix = ruleRest.join(" ");
  return prefix === "" || rest.startsWith(prefix);
}

// Known gap: bash can still write files through allowed commands (their side
// effects are invisible to path rules); OS sandboxing is needed to fix this.
export function checkBash(command: string, rules: Rule[]): BashVerdict {
  const parts = splitParts(command);
  if (parts.length === 0) return { allowed: false, reason: "empty command" };
  const relevant = rules.filter((rule) => rule.tag === "bash");
  for (const part of parts) {
    const words = part.split(/\s+/);
    const name = basename(words[0]);
    if (DANGEROUS.has(name)) {
      return { allowed: false, reason: `dangerous command "${name}"` };
    }
    if (part.includes(">")) {
      return { allowed: false, reason: `redirect in "${short(part)}"` };
    }
    if (part.includes("$(") || part.includes("`")) {
      return {
        allowed: false,
        reason: `command substitution in "${short(part)}"`,
      };
    }
    if (
      relevant.some(
        (rule) =>
          rule.effect === "deny" &&
          ruleMatches(rule, name, words.slice(1).join(" ")),
      )
    ) {
      return { allowed: false, reason: `denied by rule for "${name}"` };
    }
    if (
      !relevant.some(
        (rule) =>
          rule.effect === "allow" &&
          ruleMatches(rule, name, words.slice(1).join(" ")),
      )
    ) {
      return { allowed: false, reason: `no allow rule for "${name}"` };
    }
  }
  return { allowed: true };
}
