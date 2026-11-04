import { randomBytes } from "node:crypto";
import { chmodSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnDetachedTask } from "@hollowheap/runtime/lifecycle";
import {
  cancelProcessGroup,
  isProcessAlive,
  isSocketConnectable,
  waitForProcessExit,
} from "@hollowheap/runtime/process";
import { runnerRequest, waitForRunner } from "./socket.js";
import { type SubagentState, SubagentStore } from "./state.js";

export interface StartSubagentOptions {
  agentDir: string;
  id?: string;
  agent: string;
  task: string;
  depth: number;
  attempt?: number;
  parentSession?: string;
  command: string;
  args?: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  model?: string;
  sessionPath?: string;
  harness?: string;
  inputMode?: "jsonl" | "text";
  initialInput?: string;
  timeoutMs?: number;
}

interface RunnerConfig {
  id: string;
  statePath: string;
  logPath: string;
  socketPath: string;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  inputMode: "jsonl" | "text";
  initialInput?: string;
}

const RUNNER_SHIM = fileURLToPath(
  new URL("../runner-shim.mjs", import.meta.url),
);

export function generateSubagentId(): string {
  return `subagent-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

function writeConfig(path: string, config: RunnerConfig): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // Best-effort.
  }
  renameSync(tmp, path);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function startSubagent(
  options: StartSubagentOptions,
): Promise<SubagentState> {
  const store = new SubagentStore(options.agentDir);
  const id = options.id ?? generateSubagentId();
  const socketPath = store.socketPath(id);
  const state: SubagentState = {
    id,
    status: "starting",
    agent: options.agent,
    task: options.task,
    depth: options.depth,
    attempt: options.attempt ?? 1,
    ...(options.parentSession !== undefined
      ? { parentSession: options.parentSession }
      : {}),
    startedAt: Date.now(),
    socket: socketPath,
    harness: options.harness ?? "pi",
    inputMode: options.inputMode ?? "jsonl",
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.sessionPath !== undefined
      ? { session: options.sessionPath }
      : {}),
  };
  const configPath = join(store.dir, `${id}.runner.json`);
  const runnerLogPath = join(store.dir, `${id}.runner.log`);
  let runner: ReturnType<typeof spawnDetachedTask> | undefined;
  let runnerError: Error | undefined;

  try {
    store.ensureLog(id);
    writeConfig(configPath, {
      id,
      statePath: store.statePath(id),
      logPath: store.logPath(id),
      socketPath,
      command: options.command,
      args: [...(options.args ?? [])],
      cwd: options.cwd,
      env: options.env ?? {},
      inputMode: options.inputMode ?? "jsonl",
      ...(options.initialInput !== undefined
        ? { initialInput: options.initialInput }
        : {}),
    });
    runner = spawnDetachedTask({
      store: store.store,
      state,
      command: process.execPath,
      args: [RUNNER_SHIM, configPath],
      cwd: options.cwd,
      logPath: runnerLogPath,
      patch: (spawned) => ({
        runnerPid: spawned.pid,
        runnerStartTime: spawned.startTime,
      }),
    });
    runner.child.once("error", (error) => {
      runnerError = error;
    });
    try {
      await waitForRunner(state, options.timeoutMs ?? 5_000, runner);
    } catch (error) {
      throw runnerError ?? error;
    }
    return store.read(id) ?? state;
  } catch (error) {
    if (runner !== undefined) {
      await cancelProcessGroup(runner.pid, runner.startTime, 150);
    }
    try {
      store.updateIf(id, (current) => current.status !== "cancelled", {
        status: "failed",
        finishedAt: Date.now(),
        exitCode: null,
      });
    } catch {
      // Preserve the startup error if the state lock is also unavailable.
    }
    throw error;
  } finally {
    try {
      rmSync(configPath, { force: true });
    } catch {
      // Best-effort cleanup of the runner config (which contains child env).
    }
  }
}

export async function attachSubagent(
  agentDir: string,
  id: string,
): Promise<SubagentState | undefined> {
  const store = new SubagentStore(agentDir);
  const state = store.read(id);
  if (state === undefined) return undefined;
  const reconciled = await reconcileSubagent(agentDir, state);
  if (reconciled.status !== "running") return reconciled;
  if (reconciled.socket !== undefined) {
    try {
      await runnerRequest(reconciled, "status", undefined, { timeoutMs: 500 });
    } catch {
      // Return the persisted state; the caller can inspect/recover it.
    }
  }
  return reconciled;
}

export async function sendSubagent(
  agentDir: string,
  id: string,
  payload: unknown,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const store = new SubagentStore(agentDir);
  const state = store.read(id);
  if (state === undefined) throw new Error(`subagent not found: ${id}`);
  if (state.status !== "running") {
    throw new Error(`subagent is not running: ${id}`);
  }
  const input =
    state.inputMode === "text" &&
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof payload.message === "string"
      ? payload.message
      : payload;
  await runnerRequest(state, "send", input, options);
}

export async function abortSubagent(
  agentDir: string,
  id: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const store = new SubagentStore(agentDir);
  const state = store.read(id);
  if (state === undefined) throw new Error(`subagent not found: ${id}`);
  if (state.status !== "running" && state.status !== "starting") return;
  const pid = state.pid;
  const runnerPid = state.runnerPid;
  try {
    await runnerRequest(state, "abort", undefined, options);
  } catch {
    // The socket may be gone while the process is alive; kill the group.
    if (runnerPid !== undefined) {
      await cancelProcessGroup(runnerPid, state.runnerStartTime, 250);
    }
    if (pid !== undefined && isProcessAlive(pid, state.startTime)) {
      await cancelProcessGroup(pid, state.startTime, 250);
    }
  } finally {
    if (runnerPid !== undefined) {
      await waitForProcessExit(runnerPid, state.runnerStartTime, {
        timeoutMs: 1_000,
      });
    }
    if (pid !== undefined) {
      await waitForProcessExit(pid, state.startTime, { timeoutMs: 1_000 });
    }
    store.updateIf(id, (current) => current.status !== "completed", {
      status: "cancelled",
      finishedAt: Date.now(),
    });
  }
}

export async function waitSubagent(
  agentDir: string,
  id: string,
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<SubagentState | undefined> {
  const store = new SubagentStore(agentDir);
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (true) {
    const state = store.read(id);
    if (state === undefined) return undefined;
    const reconciled = await reconcileSubagent(agentDir, state);
    if (reconciled.status !== "running" && reconciled.status !== "starting")
      return reconciled;
    if (signal?.aborted || Date.now() >= deadline) return state;
    await sleep(Math.min(50, Math.max(5, deadline - Date.now())), signal);
  }
}

const STARTUP_GRACE_MS = 5_000;

export async function reconcileSubagent(
  agentDir: string,
  state: SubagentState,
): Promise<SubagentState> {
  if (state.status !== "running" && state.status !== "starting") return state;
  const childAlive =
    state.pid !== undefined && isProcessAlive(state.pid, state.startTime);
  const runnerAlive =
    state.runnerPid !== undefined &&
    isProcessAlive(state.runnerPid, state.runnerStartTime);
  const withinStartupGrace = Date.now() - state.startedAt < STARTUP_GRACE_MS;
  const deadProcess = state.pid !== undefined && !childAlive && !runnerAlive;
  const missingProcess = state.pid === undefined && !withinStartupGrace;
  const deadSocket =
    !withinStartupGrace &&
    state.socket !== undefined &&
    !(await isSocketConnectable(state.socket));
  if (!deadProcess && !missingProcess && !deadSocket) return state;
  const store = new SubagentStore(agentDir);
  return (
    store.updateIf(
      state.id,
      (current) =>
        current.status === "running" || current.status === "starting",
      { status: "failed", finishedAt: Date.now(), exitCode: null },
    ) ?? state
  );
}

export async function listSubagents(
  agentDir: string,
): Promise<SubagentState[]> {
  const store = new SubagentStore(agentDir);
  const all = store.list();
  return Promise.all(all.map((s) => reconcileSubagent(agentDir, s)));
}

export function readSubagentLog(agentDir: string, id: string): string {
  return new SubagentStore(agentDir).log(id);
}
