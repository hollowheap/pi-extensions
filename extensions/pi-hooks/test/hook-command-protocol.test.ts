import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  type HookEntry,
  type HookPayload,
  interpretPreHook,
  runPostHook,
  runPreHook,
} from "../src/hooks.js";

const node = process.execPath;

function payload(): HookPayload {
  return {
    event: "pre_tool",
    toolName: "bash",
    toolCallId: "call_1",
    input: { command: "ls" },
    cwd: tmpdir(),
    mode: "ask",
  };
}

describe("a hook reads the tool call on stdin and decides via stdout or exit code", () => {
  it("passes the tool call JSON on stdin and blocks when the command prints a block verdict", async () => {
    const entry: HookEntry = {
      matcher: "",
      command: node,
      args: [
        "-e",
        "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d);process.stdout.write(JSON.stringify({decision:p.toolName==='bash'?'block':'allow',reason:'from '+p.toolCallId}))})",
      ],
      timeoutMs: 5_000,
    };

    const verdict = await runPreHook(entry, payload());
    expect(verdict.block).toBe(true);
    expect(verdict.reason).toContain("from call_1");
  });

  it("uses exit code 2 and a failed spawn as block reasons", async () => {
    expect(interpretPreHook({ code: 2, stdout: "", stderr: "denied" })).toEqual(
      {
        block: true,
        reason: "denied",
      },
    );
    const verdict = await runPreHook(
      {
        matcher: "",
        command: "pi-hooks-draw-missing-binary",
        args: [],
        timeoutMs: 1_000,
      },
      payload(),
    );
    expect(verdict.block).toBe(true);
    expect(verdict.reason).toBeTruthy();
  });
});

describe("allow boundary, malformed decisions and post-hook formatting", () => {
  it("an allow decision and empty stdout do not block", async () => {
    const allow: HookEntry = {
      matcher: "",
      command: node,
      args: ["-e", "process.stdout.write(JSON.stringify({decision:'allow'}))"],
      timeoutMs: 5_000,
    };
    await expect(runPreHook(allow, payload())).resolves.toEqual({
      block: false,
    });
    expect(interpretPreHook({ code: 0, stdout: "   ", stderr: "" })).toEqual({
      block: false,
    });
  });

  it("malformed or unknown stdout decisions block with reasons", () => {
    expect(
      interpretPreHook({ code: 0, stdout: "not json", stderr: "" }),
    ).toEqual({
      block: true,
      reason: "hook printed output that is not a decision",
    });
    expect(
      interpretPreHook({
        code: 0,
        stdout: JSON.stringify({ decision: "maybe" }),
        stderr: "",
      }),
    ).toEqual({ block: true, reason: "hook returned an unknown decision" });
  });

  it("a post hook's markdown format wraps its stdout", async () => {
    const entry: HookEntry = {
      matcher: "",
      command: node,
      args: ["-e", "process.stdout.write('summary')"],
      timeoutMs: 5_000,
      format: "markdown",
    };
    await expect(runPostHook(entry, payload())).resolves.toEqual({
      output: "```\nsummary\n```",
    });
  });
});
