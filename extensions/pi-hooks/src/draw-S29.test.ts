import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  type HookEntry,
  type HookPayload,
  interpretPreHook,
  runPreHook,
} from "./hooks.js";

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

describe("S29: a hook reads the tool call on stdin and decides via stdout or exit code", () => {
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
