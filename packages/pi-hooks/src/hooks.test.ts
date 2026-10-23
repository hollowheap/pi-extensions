import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  type HookEntry,
  type HookPayload,
  matchesTool,
  runPostHook,
  runPreHook,
} from "./hooks.js";

const node = process.execPath;

function entry(overrides: Partial<HookEntry> = {}): HookEntry {
  return {
    matcher: "",
    command: node,
    args: ["-e", "process.stdout.write('')"],
    timeoutMs: 10_000,
    ...overrides,
  };
}

function payload(overrides: Partial<HookPayload> = {}): HookPayload {
  return {
    event: "pre_tool",
    toolName: "bash",
    toolCallId: "call_1",
    input: { command: "ls" },
    cwd: tmpdir(),
    mode: "ask",
    ...overrides,
  };
}

describe("matchesTool", () => {
  it("matches every tool when the matcher is empty", () => {
    expect(matchesTool(entry(), "bash")).toBe(true);
  });

  it("matches an exact tool name regardless of case", () => {
    expect(matchesTool(entry({ matcher: "Bash" }), "bash")).toBe(true);
    expect(matchesTool(entry({ matcher: "bash" }), "edit")).toBe(false);
  });

  it("matches a trailing star prefix", () => {
    expect(matchesTool(entry({ matcher: "mcp__*" }), "mcp__github")).toBe(true);
    expect(matchesTool(entry({ matcher: "mcp__*" }), "bash")).toBe(false);
  });
});

describe("runPreHook", () => {
  it("blocks when the hook asks it to", async () => {
    const verdict = await runPreHook(
      entry({
        args: [
          "-e",
          "process.stdout.write(JSON.stringify({decision:'block',reason:'not on main'}))",
        ],
      }),
      payload(),
    );
    expect(verdict).toEqual({ block: true, reason: "not on main" });
  });

  it("passes when the hook allows the call", async () => {
    const verdict = await runPreHook(
      entry({
        args: [
          "-e",
          "process.stdout.write(JSON.stringify({decision:'allow'}))",
        ],
      }),
      payload(),
    );
    expect(verdict).toEqual({ block: false });
  });

  it("passes when the hook prints nothing and exits zero", async () => {
    const verdict = await runPreHook(entry(), payload());
    expect(verdict).toEqual({ block: false });
  });

  it("blocks with stderr when the hook exits two", async () => {
    const verdict = await runPreHook(
      entry({
        args: ["-e", "process.stderr.write('refused');process.exit(2)"],
      }),
      payload(),
    );
    expect(verdict).toEqual({ block: true, reason: "refused" });
  });

  it("blocks when the hook fails", async () => {
    const verdict = await runPreHook(
      entry({ args: ["-e", "process.exit(1)"] }),
      payload(),
    );
    expect(verdict.block).toBe(true);
    expect(verdict.reason).toContain("failed");
  });

  it("blocks when the hook cannot run", async () => {
    const verdict = await runPreHook(
      entry({ command: "pi-hooks-missing-binary", args: [] }),
      payload(),
    );
    expect(verdict.block).toBe(true);
    expect(verdict.reason).toContain("command not found");
  });

  it("hands the tool call to the hook on stdin", async () => {
    const verdict = await runPreHook(
      entry({
        args: [
          "-e",
          "let d='';process.stdin.on('data',(c)=>{d+=c});process.stdin.on('end',()=>{const p=JSON.parse(d);process.stdout.write(JSON.stringify({decision:'block',reason:p.toolName+' '+p.cwd}))})",
        ],
      }),
      payload({ toolName: "edit" }),
    );
    expect(verdict).toEqual({
      block: true,
      reason: `edit ${tmpdir()}`,
    });
  });
});

describe("runPostHook", () => {
  it("returns the hook output", async () => {
    const result = await runPostHook(
      entry({ args: ["-e", "process.stdout.write('tests passed')"] }),
      payload({ event: "post_tool" }),
    );
    expect(result.output).toBe("tests passed");
    expect(result.error).toBeUndefined();
  });

  it("reports a failure without an output", async () => {
    const result = await runPostHook(
      entry({ command: "pi-hooks-missing-binary", args: [] }),
      payload({ event: "post_tool" }),
    );
    expect(result.output).toBeUndefined();
    expect(result.error).toContain("command not found");
  });
});
