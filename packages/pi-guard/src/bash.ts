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

export type BashDecision = "allow" | "ask" | "deny";

export interface BashVerdict {
  decision: BashDecision;
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
  if (parts.length === 0) {
    return { decision: "deny", reason: "empty command" };
  }
  const relevant = rules.filter((rule) => rule.tag === "shell");
  let askReason: string | undefined;
  for (const part of parts) {
    const words = part.split(/\s+/);
    const name = basename(words[0]);
    if (DANGEROUS.has(name)) {
      return { decision: "deny", reason: `dangerous command "${name}"` };
    }
    if (part.includes(">")) {
      return { decision: "deny", reason: `redirect in "${short(part)}"` };
    }
    if (part.includes("$(") || part.includes("`")) {
      return {
        decision: "deny",
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
      return { decision: "deny", reason: `denied by rule for "${name}"` };
    }
    if (
      !relevant.some(
        (rule) =>
          rule.effect === "allow" &&
          ruleMatches(rule, name, words.slice(1).join(" ")),
      ) &&
      askReason === undefined
    ) {
      askReason = `no allow rule for "${name}"`;
    }
  }
  if (askReason !== undefined) return { decision: "ask", reason: askReason };
  return { decision: "allow" };
}
