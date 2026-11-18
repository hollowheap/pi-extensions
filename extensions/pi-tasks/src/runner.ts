import { readFileSync } from "node:fs";
import {
  cancelProcessGroup,
  isProcessAlive,
  terminateProcessGroups,
} from "@hollowheap/runtime/process";
export { readProcStartTime } from "@hollowheap/runtime/process";
import { spawnDetachedTask } from "@hollowheap/runtime/lifecycle";
import {
  type SandboxOptions,
  wrapSandboxCommand,
} from "@hollowheap/runtime/sandbox";
import { LockedProcessStore } from "@hollowheap/runtime/store";
import { loadTasksConfig, resolveTasksSandboxOptions } from "./config.js";
import {
  type TaskMetadata,
  type TaskRecord,
  generateTaskId,
  listTaskMetadata,
  readTaskMetadata,
  taskLogPath,
  taskMetaPath,
  toTaskRecord,
} from "./registry.js";

const SHIM_SCRIPT = readFileSync(
  new URL("./shim.cjs", import.meta.url),
  "utf8",
);

const STARTUP_GRACE_MS = 5_000;

export function reconcileTask(
  agentDir: string,
  id: string,
): TaskRecord | undefined {
  const store = new LockedProcessStore<TaskMetadata>(agentDir);
  const meta = store.read(id);
  if (!meta) return undefined;
  if (meta.status === "running") {
    const withinStartupGrace =
      meta.pid === undefined && Date.now() - meta.startedAt < STARTUP_GRACE_MS;
    if (!withinStartupGrace && !isProcessAlive(meta.pid, meta.startTime)) {
      if (meta.innerPid !== undefined) {
        void cancelProcessGroup(meta.innerPid, meta.innerStartTime, 100);
      }
      const updated = store.updateIf(
        id,
        (current) => current.status === "running",
        { status: "failed", exitCode: null, finishedAt: Date.now() },
      );
      return toTaskRecord(agentDir, updated ?? meta);
    }
  }
  return toTaskRecord(agentDir, meta);
}

export function reconcileAllTasks(agentDir: string): TaskRecord[] {
  const metas = listTaskMetadata(agentDir);
  const records: TaskRecord[] = [];
  for (const meta of metas) {
    const rec = reconcileTask(agentDir, meta.id);
    if (rec) records.push(rec);
  }
  return records;
}

export interface SpawnShellTaskOptions {
  agentDir: string;
  command: string;
  cwd: string;
  id?: string;
  shell?: string;
  dependsOn?: string[];
  sandbox?: boolean | SandboxOptions;
}

export async function spawnShellTask(
  opts: SpawnShellTaskOptions,
): Promise<TaskRecord> {
  const id = opts.id ?? generateTaskId();
  const startedAt = Date.now();
  const shellBin = opts.shell ?? process.env.SHELL ?? "/bin/sh";
  let spawnCommand = shellBin;
  let spawnArgs = ["-c", opts.command];
  const effectiveSandbox =
    opts.sandbox !== undefined
      ? opts.sandbox
      : resolveTasksSandboxOptions(loadTasksConfig(opts.agentDir).sandbox);
  if (effectiveSandbox) {
    const sandboxOpts: SandboxOptions =
      typeof effectiveSandbox === "object"
        ? { ...effectiveSandbox, cwd: effectiveSandbox.cwd ?? opts.cwd }
        : { cwd: opts.cwd };
    const wrapped = wrapSandboxCommand(spawnCommand, spawnArgs, sandboxOpts);
    spawnCommand = wrapped.command;
    spawnArgs = wrapped.args;
  }

  const initialMeta: TaskMetadata = {
    id,
    kind: "shell",
    status: "running",
    command: opts.command,
    cwd: opts.cwd,
    startedAt,
    dependsOn: opts.dependsOn,
  };
  const store = new LockedProcessStore<TaskMetadata>(opts.agentDir);
  const metaPath = taskMetaPath(opts.agentDir, id);
  const logPath = taskLogPath(opts.agentDir, id);

  try {
    spawnDetachedTask({
      store,
      state: initialMeta,
      command: process.execPath,
      args: [
        "-e",
        SHIM_SCRIPT,
        metaPath,
        logPath,
        opts.cwd,
        spawnCommand,
        "--args-json",
        JSON.stringify(spawnArgs),
      ],
      cwd: opts.cwd,
      logPath,
    });
  } catch (error) {
    store.updateIf(id, (current) => current.status === "running", {
      status: "failed",
      exitCode: null,
      finishedAt: Date.now(),
    });
    throw error;
  }

  const current = store.read(id) ?? initialMeta;
  return toTaskRecord(opts.agentDir, current);
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

export async function waitForTask(
  agentDir: string,
  id: string,
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<TaskRecord | undefined> {
  const clampedTimeout = Math.max(0, Math.min(timeoutMs, 600_000));
  const deadline = Date.now() + clampedTimeout;

  while (true) {
    const current = reconcileTask(agentDir, id);
    if (!current) return undefined;
    if (current.status !== "running") return current;
    if (signal?.aborted || Date.now() >= deadline) return current;
    const remaining = deadline - Date.now();
    await sleep(Math.min(40, Math.max(5, remaining)), signal);
  }
}

export async function cancelTask(
  agentDir: string,
  id: string,
  graceMs = 250,
): Promise<TaskRecord | undefined> {
  const meta = readTaskMetadata(agentDir, id);
  if (!meta) return undefined;
  if (meta.status !== "running") {
    return toTaskRecord(agentDir, meta);
  }

  const groups = [
    ...(meta.pid !== undefined
      ? [{ pid: meta.pid, startTime: meta.startTime }]
      : []),
    ...(meta.innerPid !== undefined
      ? [{ pid: meta.innerPid, startTime: meta.innerStartTime }]
      : []),
  ];
  const wasAlive = groups.some((group) =>
    isProcessAlive(group.pid, group.startTime),
  );
  const allTerminated =
    groups.length > 0
      ? await terminateProcessGroups(groups, { graceMs })
      : false;
  if (!wasAlive || !allTerminated) {
    return toTaskRecord(agentDir, readTaskMetadata(agentDir, id) ?? meta);
  }

  const store = new LockedProcessStore<TaskMetadata>(agentDir);
  const cancelled = store.updateIf(
    id,
    (current) =>
      current.status === "running" ||
      current.status === "cancelled" ||
      (current.status === "failed" && current.exitCode === null),
    { status: "cancelled", finishedAt: Date.now() },
  );
  return toTaskRecord(
    agentDir,
    cancelled ?? readTaskMetadata(agentDir, id) ?? meta,
  );
}
