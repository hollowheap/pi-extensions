import { describe, expect, it } from "vitest";
import {
  type HookEntry,
  type HookPayload,
  evaluateCondition,
  matchesTool,
} from "./hooks.js";

function entry(condition: string): HookEntry {
  return {
    matcher: "",
    command: process.execPath,
    args: [],
    timeoutMs: 1000,
    condition,
  };
}

function payload(): HookPayload {
  return {
    event: "pre_tool",
    toolName: "bash",
    toolCallId: "call_1",
    input: { command: "ls" },
    cwd: "/repo",
    mode: "ask",
  };
}

describe("S181 malformed hook condition fails closed", () => {
  it("throws instead of silently allowing a condition that does not parse", () => {
    expect(() => evaluateCondition(entry("nonsense"), payload())).toThrow(
      /invalid hook condition/,
    );
  });

  it("S181 C02: an empty or whitespace-only condition evaluates to true", () => {
    expect(evaluateCondition(entry(""), payload())).toBe(true);
    expect(evaluateCondition(entry("   \t "), payload())).toBe(true);
  });

  it("S181 C03: an invalid regex inside matches() propagates a parse failure", () => {
    expect(() =>
      evaluateCondition(entry("matches(path, '[')"), payload()),
    ).toThrow(SyntaxError);
  });

  it("S181 C04: matcher and condition combine to gate a pre-tool hook", () => {
    const gated = { ...entry("tool == 'bash'"), matcher: "bash*" };
    expect(matchesTool(gated, "bash")).toBe(true);
    expect(matchesTool(gated, "write")).toBe(false);
    expect(evaluateCondition(gated, payload())).toBe(true);
    expect(evaluateCondition(gated, { ...payload(), toolName: "write" })).toBe(
      false,
    );
  });
});
