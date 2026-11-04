import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProcessAlive } from "@hollowheap/runtime";
import { afterEach, describe, expect, it } from "vitest";
import {
  abortSubagent,
  attachSubagent,
  readSubagentLog,
  reconcileSubagent,
  sendSubagent,
  startSubagent,
  waitSubagent,
} from "./runner.js";
import { SubagentStore } from "./state.js";

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

const TEXT_CHILD = String.raw`
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  console.log("text:" + chunk.trim());
  if (chunk.includes("exit")) process.exit(0);
});
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
    expect(existsSync(join(root, "subagents", `${state.id}.runner.json`))).toBe(
      false,
    );
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

  it("keeps a starting runner through the grace period, then fails a stale socket", async () => {
    const root = agentDir();
    const store = new SubagentStore(root);
    const socket = store.socketPath("startup");
    store.write({
      id: "startup",
      status: "starting",
      agent: "scout",
      task: "find",
      depth: 1,
      attempt: 1,
      startedAt: Date.now(),
      pid: process.pid,
      socket,
    });

    const during = await reconcileSubagent(
      root,
      store.read("startup") as never,
    );
    expect(during.status).toBe("starting");

    const existing = store.read("startup");
    if (existing === undefined) throw new Error("missing startup state");
    store.write({ ...existing, startedAt: Date.now() - 10_000 });
    const after = await reconcileSubagent(root, store.read("startup") as never);
    expect(after.status).toBe("failed");
  });

  it("fails a runner whose pid was reused", async () => {
    const root = agentDir();
    const store = new SubagentStore(root);
    store.write({
      id: "reused",
      status: "running",
      agent: "scout",
      task: "find",
      depth: 1,
      attempt: 1,
      startedAt: Date.now() - 10_000,
      pid: process.pid,
      startTime: 1,
    });
    const state = await reconcileSubagent(root, store.read("reused") as never);
    expect(state.status).toBe("failed");
  });

  it("kills the process group when abort cannot reach the socket", async () => {
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
    rmSync(state.socket as string, { force: true });
    await abortSubagent(root, state.id);
    const done = await waitSubagent(root, state.id, 2_000);
    expect(done?.status).toBe("cancelled");
    expect(state.runnerPid).toBeDefined();
    expect(isProcessAlive(state.runnerPid, state.runnerStartTime)).toBe(false);
    expect(isProcessAlive(state.pid, state.startTime)).toBe(false);
  });

  it("cancels a starting state without a pid", async () => {
    const root = agentDir();
    const store = new SubagentStore(root);
    store.write({
      id: "starting",
      status: "starting",
      agent: "scout",
      task: "find",
      depth: 1,
      attempt: 1,
      startedAt: Date.now(),
      socket: store.socketPath("starting"),
    });
    await abortSubagent(root, "starting");
    expect(store.read("starting")?.status).toBe("cancelled");
  });

  it("marks a state failed when the runner cannot be spawned", async () => {
    const root = agentDir();
    await expect(
      startSubagent({
        agentDir: root,
        agent: "scout",
        task: "find",
        depth: 1,
        command: process.execPath,
        args: ["-e", ""],
        cwd: join(root, "missing-cwd"),
      }),
    ).rejects.toThrow();
    const states = new SubagentStore(root).list();
    expect(states).toHaveLength(1);
    expect(states[0]?.status).toBe("failed");
  });

  it("writes initial and steering text to generic harness stdin", async () => {
    const root = agentDir();
    const state = await startSubagent({
      agentDir: root,
      agent: "claude",
      task: "find",
      depth: 1,
      command: process.execPath,
      args: ["-e", TEXT_CHILD],
      cwd: process.cwd(),
      inputMode: "text",
      initialInput: "hello",
    });
    expect(state.inputMode).toBe("text");
    await sendSubagent(root, state.id, { type: "steer", message: "exit" });
    const done = await waitSubagent(root, state.id, 2_000);
    expect(done?.status).toBe("completed");
    const log = readSubagentLog(root, state.id);
    expect(log).toContain("text:hello");
    expect(log).toContain("exit");
  });

  it("reports a missing id", async () => {
    const root = agentDir();
    await expect(attachSubagent(root, "missing")).resolves.toBeUndefined();
    await expect(
      sendSubagent(root, "missing", { type: "prompt" }),
    ).rejects.toThrow(/not found/);
  });
});
