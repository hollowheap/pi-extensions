import { randomBytes } from "node:crypto";
import { chmodSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cancelProcessGroup, spawnDetachedProcess } from "@hollowheap/process";
import { RUNNER_SHIM } from "./runner-shim.js";
import { runnerRequest, waitForRunner } from "./socket.js";
import { type SubagentState, SubagentStore } from "./state.js";

export interface StartSubagentOptions {
  agentDir: string;
  id?: string;
  agent: string;
  task: string;
  depth: number;
  attempt?: number;
  command: string;
  args?: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  model?: string;
  sessionPath?: string;
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
}

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
    startedAt: Date.now(),
    socket: socketPath,
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.sessionPath !== undefined
      ? { session: options.sessionPath }
      : {}),
  };
  store.ensureLog(id);
  store.write(state);

  const configPath = join(store.dir, `${id}.runner.json`);
  const runnerLogPath = join(store.dir, `${id}.runner.log`);
  writeConfig(configPath, {
    id,
    statePath: store.statePath(id),
    logPath: store.logPath(id),
    socketPath,
    command: options.command,
    args: [...(options.args ?? [])],
    cwd: options.cwd,
    env: options.env ?? {},
  });

  const runner = spawnDetachedProcess({
    command: process.execPath,
    args: ["-e", RUNNER_SHIM, configPath],
    cwd: options.cwd,
    logPath: runnerLogPath,
  });

  try {
    await waitForRunner(state, options.timeoutMs ?? 2_000);
  } catch (error) {
    await cancelProcessGroup(runner.pid, runner.startTime, 100);
    store.update(id, {
      status: "failed",
      finishedAt: Date.now(),
      exitCode: null,
    });
    throw error;
  }
  return store.read(id) ?? state;
}

export async function attachSubagent(
  agentDir: string,
  id: string,
): Promise<SubagentState | undefined> {
  const store = new SubagentStore(agentDir);
  const state = store.read(id);
  if (state === undefined) return undefined;
  const reconciled = reconcileSubagent(agentDir, state);
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
  await runnerRequest(state, "send", payload, options);
}

export async function abortSubagent(
  agentDir: string,
  id: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const store = new SubagentStore(agentDir);
  const state = store.read(id);
  if (state === undefined) throw new Error(`subagent not found: ${id}`);
  if (state.status !== "running") return;
  // Check if process is dead
  if (state.pid !== undefined && !isPidAlive(state.pid)) {
    store.update(id, { status: "cancelled", finishedAt: Date.now() });
    return;
  }
  try {
    await runnerRequest(state, "abort", undefined, options);
  } catch {
    // Socket unreachable; update state directly
    store.update(id, { status: "cancelled", finishedAt: Date.now() });
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
    const reconciled = reconcileSubagent(agentDir, state);
    if (reconciled.status !== "running" && reconciled.status !== "starting")
      return reconciled;
    if (signal?.aborted || Date.now() >= deadline) return state;
    await sleep(Math.min(50, Math.max(5, deadline - Date.now())), signal);
  }
}

function isPidAlive(pid: number | undefined): boolean {
  if (pid === undefined) return true; // unknown, assume alive
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function reconcileSubagent(
  agentDir: string,
  state: SubagentState,
): SubagentState {
  if (
    (state.status === "running" || state.status === "starting") &&
    state.pid !== undefined &&
    !isPidAlive(state.pid)
  ) {
    const store = new SubagentStore(agentDir);
    const updated: SubagentState = {
      ...state,
      status: "failed",
      finishedAt: Date.now(),
      exitCode: null,
    };
    store.write(updated);
    return updated;
  }
  return state;
}

export function listSubagents(agentDir: string): SubagentState[] {
  const store = new SubagentStore(agentDir);
  const all = store.list();
  return all.map((s) => reconcileSubagent(agentDir, s));
}

export function readSubagentLog(agentDir: string, id: string): string {
  return new SubagentStore(agentDir).log(id);
}
