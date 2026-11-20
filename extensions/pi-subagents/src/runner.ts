import { randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { abortableDelay } from "@hollowheap/runtime/abort";
import { spawnDetachedTask } from "@hollowheap/runtime/lifecycle";
import {
  isProcessAlive,
  isSocketConnectable,
  readProcStartTime,
  terminateProcessGroups,
} from "@hollowheap/runtime/process";
import {
  type SandboxOptions,
  wrapSandboxCommand,
} from "@hollowheap/runtime/sandbox";
import {
  type SubagentHarnessTransport,
  loadSubagentsConfig,
  resolveSubagentSandboxOptions,
} from "./settings.js";
import {
  readLogFailureDetail,
  runnerRequest,
  waitForRunner,
} from "./socket.js";
import { type SubagentState, SubagentStore } from "./state.js";

export interface StartSubagentOptions {
  agentDir: string;
  id?: string;
  agent: string;
  task: string;
  depth: number;
  attempt?: number;
  project?: string;
  parentSession?: string;
  command: string;
  args?: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  model?: string;
  workspace?: string;
  isolated?: boolean;
  sessionPath?: string;
  harness?: string;
  transport?: SubagentHarnessTransport;
  inputMode?: "jsonl" | "text";
  initialInput?: string;
  timeoutMs?: number;
  sandbox?: boolean | SandboxOptions;
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
    ...(options.project !== undefined ? { project: options.project } : {}),
    ...(options.parentSession !== undefined
      ? { parentSession: options.parentSession }
      : {}),
    startedAt: Date.now(),
    socket: socketPath,
    harness: options.harness ?? "pi",
    ...(options.transport !== undefined
      ? { transport: options.transport }
      : {}),
    inputMode: options.inputMode ?? "jsonl",
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.workspace !== undefined
      ? { workspace: options.workspace }
      : {}),
    ...(options.isolated === true ? { isolated: true } : {}),
    ...(options.sessionPath !== undefined
      ? { session: options.sessionPath }
      : {}),
  };
  const configPath = join(store.dir, `${id}.runner.json`);
  const runnerLogPath = join(store.dir, `${id}.runner.log`);
  let runner: ReturnType<typeof spawnDetachedTask> | undefined;
  let runnerError: Error | undefined;

  const effectiveSandbox =
    options.sandbox !== undefined
      ? options.sandbox
      : resolveSubagentSandboxOptions(
          loadSubagentsConfig(options.agentDir),
          options.agent,
        );

  try {
    store.ensureLog(id);
    let childCommand = options.command;
    let childArgs = [...(options.args ?? [])];
    if (effectiveSandbox) {
      const resolvedAgentDir = resolve(options.agentDir);
      mkdirSync(resolvedAgentDir, { recursive: true, mode: 0o700 });
      const writablePaths: string[] = [resolvedAgentDir];
      if (options.sessionPath !== undefined) {
        const sessionDir = dirname(resolve(options.cwd, options.sessionPath));
        mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
        if (sessionDir !== resolvedAgentDir) {
          writablePaths.push(sessionDir);
        }
      }
      const sandboxOpts: SandboxOptions =
        typeof effectiveSandbox === "object"
          ? {
              ...effectiveSandbox,
              cwd: effectiveSandbox.cwd ?? options.cwd,
              writablePaths: [
                ...(effectiveSandbox.writablePaths ?? []),
                ...writablePaths,
              ],
            }
          : { cwd: options.cwd, writablePaths };
      const wrapped = wrapSandboxCommand(childCommand, childArgs, sandboxOpts);
      childCommand = wrapped.command;
      childArgs = wrapped.args;
    }

    writeConfig(configPath, {
      id,
      statePath: store.statePath(id),
      logPath: store.logPath(id),
      socketPath,
      command: childCommand,
      args: childArgs,
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
      await waitForRunner(state, options.timeoutMs ?? 5_000, {
        ...runner,
        childLogPath: store.logPath(id),
      });
    } catch (error) {
      throw runnerError ?? error;
    }
    const started = store.read(id) ?? state;
    if (
      started.status !== "running" ||
      started.runnerPid !== runner.pid ||
      started.pid === undefined ||
      started.startTime !== undefined
    ) {
      return started;
    }
    const startTime = readProcStartTime(started.pid);
    if (startTime === undefined) return started;
    return (
      store.updateIf(
        id,
        (current) =>
          current.status === "running" &&
          current.attempt === started.attempt &&
          current.runnerPid === started.runnerPid &&
          current.pid === started.pid &&
          current.startTime === undefined,
        { startTime },
      ) ?? started
    );
  } catch (error) {
    const latest = store.read(id);
    const groups = [
      ...(runner !== undefined
        ? [{ pid: runner.pid, startTime: runner.startTime }]
        : []),
      ...(latest?.pid !== undefined
        ? [{ pid: latest.pid, startTime: latest.startTime }]
        : []),
    ];
    if (groups.length > 0) {
      await terminateProcessGroups(groups, { graceMs: 150 });
    }
    try {
      rmSync(socketPath, { force: true });
    } catch {
      // Best-effort cleanup of any stale control socket.
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
  try {
    await runnerRequest(state, "send", input, options);
  } catch (error) {
    const logDetail = readLogFailureDetail([
      store.logPath(id),
      join(store.dir, `${id}.runner.log`),
    ]);
    if (logDetail !== undefined) {
      throw new Error(`subagent ${id} exited: ${logDetail}`);
    }
    throw error;
  }
}

export async function abortSubagent(
  agentDir: string,
  id: string,
): Promise<void> {
  const store = new SubagentStore(agentDir);
  const state = store.read(id);
  if (state === undefined) throw new Error(`subagent not found: ${id}`);
  const childAlive =
    state.pid !== undefined && isProcessAlive(state.pid, state.startTime);
  if (
    state.status !== "running" &&
    state.status !== "starting" &&
    state.status !== "cancelled" &&
    !childAlive
  ) {
    return;
  }
  if (
    state.status === "starting" &&
    state.pid === undefined &&
    state.runnerPid !== undefined &&
    isProcessAlive(state.runnerPid, state.runnerStartTime)
  ) {
    throw new Error(`subagent is still starting; retry cancellation: ${id}`);
  }

  const groups = [
    ...(state.runnerPid !== undefined
      ? [{ pid: state.runnerPid, startTime: state.runnerStartTime }]
      : []),
    ...(state.pid !== undefined
      ? [{ pid: state.pid, startTime: state.startTime }]
      : []),
  ];
  if (
    groups.some(
      ({ pid, startTime }) => startTime === undefined && isProcessAlive(pid),
    ) ||
    !(await terminateProcessGroups(groups))
  ) {
    throw new Error(`unable to confirm subagent process group exit: ${id}`);
  }

  const sameRun = (current: SubagentState) =>
    current.attempt === state.attempt &&
    current.runnerPid === state.runnerPid &&
    current.runnerStartTime === state.runnerStartTime &&
    current.pid === state.pid &&
    current.startTime === state.startTime;
  const finalState = store.updateIf(
    id,
    (current) =>
      sameRun(current) &&
      current.status !== "completed" &&
      (current.status !== "cancelled" || current.finishedAt === undefined),
    { status: "cancelled", finishedAt: Date.now() },
  );
  if (
    finalState === undefined ||
    !sameRun(finalState) ||
    (finalState.status !== "cancelled" && finalState.status !== "completed")
  ) {
    throw new Error(`subagent changed during cancellation: ${id}`);
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
    await abortableDelay(
      Math.min(50, Math.max(5, deadline - Date.now())),
      signal,
    );
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
    !childAlive &&
    state.socket !== undefined &&
    !(await isSocketConnectable(state.socket));
  // The runner owns terminal-state writes, so a dead one cannot report its child's exit.
  const orphanedRunner =
    !withinStartupGrace &&
    childAlive &&
    state.runnerPid !== undefined &&
    !runnerAlive &&
    state.socket !== undefined &&
    !(await isSocketConnectable(state.socket));
  if (!deadProcess && !missingProcess && !deadSocket && !orphanedRunner) {
    return state;
  }
  const store = new SubagentStore(agentDir);
  return (
    store.updateIf(
      state.id,
      (current) =>
        (current.status === "running" || current.status === "starting") &&
        current.attempt === state.attempt &&
        current.startedAt === state.startedAt,
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
