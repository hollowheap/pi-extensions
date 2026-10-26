import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  abortSubagent,
  attachSubagent,
  readSubagentLog,
  sendSubagent,
  startSubagent,
  waitSubagent,
} from "./runner.js";

const CHILD = String.raw`
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");
    if (line.trim() === "") continue;
    const request = JSON.parse(line);
    console.log(JSON.stringify({ type: "seen", message: request.message }));
    if (request.type === "prompt") setTimeout(() => process.exit(0), 10);
  }
});
`;

const LONG_CHILD = String.raw`
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  if (chunk.includes("\"prompt\"")) console.log("prompt received");
});
setInterval(() => {}, 1000);
`;

const dirs: string[] = [];

function agentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-subagents-runner-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("subagent runner", () => {
  it("starts a detached child, forwards a prompt, logs output, and completes", async () => {
    const root = agentDir();
    const state = await startSubagent({
      agentDir: root,
      agent: "scout",
      task: "find",
      depth: 1,
      command: process.execPath,
      args: ["-e", CHILD],
      cwd: process.cwd(),
    });

    expect(state.status).toBe("running");
    expect(state.socket).toBeDefined();
    await sendSubagent(root, state.id, {
      id: 1,
      type: "prompt",
      message: "hello",
    });
    const done = await waitSubagent(root, state.id, 2_000);
    expect(done?.status).toBe("completed");
    expect(done?.exitCode).toBe(0);
    expect(readSubagentLog(root, state.id)).toContain("hello");

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(existsSync(state.socket as string)).toBe(false);
  });

  it("re-attaches by id and aborts a running child", async () => {
    const root = agentDir();
    const state = await startSubagent({
      agentDir: root,
      agent: "worker",
      task: "wait",
      depth: 1,
      command: process.execPath,
      args: ["-e", LONG_CHILD],
      cwd: process.cwd(),
    });

    const attached = await attachSubagent(root, state.id);
    expect(attached?.id).toBe(state.id);
    await sendSubagent(root, state.id, {
      id: 1,
      type: "prompt",
      message: "stay",
    });
    await abortSubagent(root, state.id);
    const done = await waitSubagent(root, state.id, 2_000);
    expect(done?.status).toBe("cancelled");
  });

  it("reports a missing id", async () => {
    const root = agentDir();
    await expect(attachSubagent(root, "missing")).resolves.toBeUndefined();
    await expect(
      sendSubagent(root, "missing", { type: "prompt" }),
    ).rejects.toThrow(/not found/);
  });
});
