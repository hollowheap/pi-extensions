import { describe, expect, it } from "vitest";
import type { HookEntry, HookPayload } from "./hooks.js";
import {
  evaluateCondition,
  interpretPreHook,
  matchesTool,
  runPostHook,
} from "./hooks.js";

function payload(toolName: string): HookPayload {
  return {
    event: "post_tool",
    toolName,
    toolCallId: "1",
    input: {},
    cwd: process.cwd(),
    mode: "manual",
  };
}

function entry(overrides: Partial<HookEntry> = {}): HookEntry {
  return {
    matcher: "*",
    command: "printf",
    args: ["hello hook"],
    timeoutMs: 5_000,
    ...overrides,
  };
}

describe("S133 hook conditions and formatting", () => {
  it("filters by tool and conditions and formats decisions and output", async () => {
    expect(matchesTool(entry({ matcher: "write*" }), "write_file")).toBe(true);
    expect(matchesTool(entry({ matcher: "write*" }), "read")).toBe(false);

    const conditional = entry({ condition: "tool == 'write'" });
    expect(evaluateCondition(conditional, payload("read"))).toBe(false);
    expect(evaluateCondition(conditional, payload("write"))).toBe(true);

    expect(
      interpretPreHook({
        code: 0,
        stdout: '{"decision":"block","reason":"nope"}',
        stderr: "",
      }),
    ).toMatchObject({ block: true, reason: "nope" });

    expect(
      await runPostHook(entry({ format: "markdown" }), payload("read")),
    ).toEqual({ output: "```\nhello hook\n```" });
    expect(
      await runPostHook(entry({ format: "plain" }), payload("read")),
    ).toEqual({ output: "hello hook" });
  });
});
