import { describe, expect, it } from "vitest";
import {
  type HookEntry,
  type HookPayload,
  evaluateCondition,
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
});
