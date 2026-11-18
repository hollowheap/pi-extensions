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

  it("S133 C02: empty conditions and matchers accept everything", () => {
    const withCommand = {
      ...payload("read"),
      input: { command: "/repo/secret/key" },
    };
    expect(evaluateCondition(entry(), withCommand)).toBe(true);
    expect(matchesTool(entry({ matcher: "" }), "anything")).toBe(true);
    expect(
      evaluateCondition(
        entry({ condition: "path contains 'secret'" }),
        withCommand,
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        entry({ condition: "path contains 'public'" }),
        withCommand,
      ),
    ).toBe(false);
  });

  it("S133 C03: non-conforming hook output blocks with a reason", () => {
    expect(
      interpretPreHook({ code: 2, stdout: "", stderr: "denied by policy" }),
    ).toEqual({ block: true, reason: "denied by policy" });
    expect(
      interpretPreHook({ code: 0, stdout: "not json", stderr: "" }),
    ).toEqual({
      block: true,
      reason: "hook printed output that is not a decision",
    });
    expect(
      interpretPreHook({
        code: 0,
        stdout: '{"decision":"allow"}',
        stderr: "",
      }),
    ).toEqual({ block: false });
  });

  it("S133 C04: a relative command without a config dir is refused", async () => {
    expect(
      await runPostHook(entry({ command: "./missing.sh" }), payload("read")),
    ).toEqual({
      error:
        'cannot execute relative command "./missing.sh" without declaring config directory',
    });
  });
});
