import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

  it("keeps a starting runner through the grace period, then fails a stale socket when the child is not alive", async () => {
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

  it("keeps a live child running even when its socket is unreachable after grace", async () => {
    const root = agentDir();
    const store = new SubagentStore(root);
    store.write({
      id: "live-no-sock",
      status: "running",
      agent: "scout",
      task: "find",
      depth: 1,
      attempt: 1,
      startedAt: Date.now() - 10_000,
      pid: process.pid,
      socket: store.socketPath("live-no-sock"),
    });

    const reconciled = await reconcileSubagent(
      root,
      store.read("live-no-sock") as never,
    );
    expect(reconciled.status).toBe("running");
  });

  it("kills the child group when the runner fails on server listen error", async () => {
    const root = agentDir();
    const store = new SubagentStore(root);
    const statePath = store.statePath("listen-fail");
    const logPath = store.logPath("listen-fail");
    const runnerConfigPath = join(root, "subagents", "listen-fail.runner.json");
    store.write({
      id: "listen-fail",
      status: "starting",
      agent: "worker",
      task: "wait",
      depth: 1,
      attempt: 1,
      startedAt: Date.now(),
    });
    const { writeFileSync } = await import("node:fs");
    const { spawn } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const shimPath = fileURLToPath(
      new URL("../runner-shim.mjs", import.meta.url),
    );
    writeFileSync(
      runnerConfigPath,
      JSON.stringify({
        statePath,
        logPath,
        socketPath: join(root, "x".repeat(140), "bad.sock"),
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        cwd: process.cwd(),
      }),
    );

    await new Promise<void>((resolve) => {
      const proc = spawn(process.execPath, [shimPath, runnerConfigPath], {
        stdio: "ignore",
      });
      proc.on("exit", () => resolve());
    });

    const after = store.read("listen-fail");
    expect(after?.status).toBe("failed");
    expect(after?.pid).toBeTypeOf("number");
    expect(isProcessAlive(after?.pid, after?.startTime)).toBe(false);
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
      transport: "acp",
      initialInput: "hello",
    });
    expect(state.inputMode).toBe("text");
    await sendSubagent(root, state.id, { type: "steer", message: "exit" });
    const done = await waitSubagent(root, state.id, 2_000);
    expect(done).toMatchObject({ status: "completed", transport: "acp" });
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

  it("wraps child command with bwrap and binds subagents store/session dir", async () => {
    const root = agentDir();
    const binDir = agentDir();
    const workDir = agentDir();
    const argsLog = join(binDir, "bwrap-args.json");
    const fakeBwrap = join(binDir, "bwrap");
    writeFileSync(
      fakeBwrap,
      `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(argsLog)}, JSON.stringify(args));
const sep = args.indexOf("--");
const res = spawnSync(args[sep + 1], args.slice(sep + 2), { stdio: "inherit" });
process.exit(res.status ?? 1);
`,
      { mode: 0o755 },
    );

    const sessionPath = join(root, "sessions", "child.session.jsonl");
    const state = await startSubagent({
      agentDir: root,
      agent: "scout",
      task: "find",
      depth: 1,
      command: process.execPath,
      args: ["-e", CHILD],
      cwd: workDir,
      sessionPath,
      sandbox: { offline: true, bwrapBinary: fakeBwrap },
    });
    await sendSubagent(root, state.id, {
      id: 1,
      type: "prompt",
      message: "sandbox-hello",
    });
    const done = await waitSubagent(root, state.id, 2_000);
    expect(done?.status).toBe("completed");
    expect(readSubagentLog(root, state.id)).toContain("sandbox-hello");

    const recorded = JSON.parse(readFileSync(argsLog, "utf8")) as string[];
    expect(recorded).toContain("--ro-bind");
    expect(recorded).toContain("--unshare-net");
    expect(recorded).toContain(workDir);
    expect(recorded).not.toContain(join(root, "subagents"));
    expect(recorded).toContain(join(root, "sessions"));
    const firstSep = recorded.indexOf("--");
    expect(recorded.indexOf(join(root, "sessions"))).toBeLessThan(firstSep);

    if (process.getuid?.() !== 0) {
      chmodSync(fakeBwrap, 0o644);
      await expect(
        startSubagent({
          agentDir: root,
          agent: "scout",
          task: "find",
          depth: 1,
          command: process.execPath,
          args: ["-e", CHILD],
          cwd: workDir,
          sandbox: { bwrapBinary: fakeBwrap },
        }),
      ).rejects.toThrow(/permission/i);
    }
  });

  it("fails an orphaned live child whose runner died and socket is gone", async () => {
    const root = agentDir();
    const store = new SubagentStore(root);
    store.write({
      id: "orphan",
      status: "running",
      agent: "scout",
      task: "find",
      depth: 1,
      attempt: 1,
      startedAt: Date.now() - 10_000,
      pid: process.pid,
      runnerPid: 999_999_999,
      socket: store.socketPath("orphan"),
    });

    const orphan = store.read("orphan");
    if (orphan === undefined) throw new Error("missing orphan state");
    const reconciled = await reconcileSubagent(root, orphan);
    expect(reconciled.status).toBe("failed");
    const waited = await waitSubagent(root, "orphan", 100);
    expect(waited?.status).toBe("failed");
  });
});
