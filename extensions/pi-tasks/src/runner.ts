import { readFileSync } from "node:fs";
import {
  cancelProcessGroup,
  isProcessAlive,
} from "@hollowheap/runtime/process";
export { readProcStartTime } from "@hollowheap/runtime/process";
import { spawnDetachedTask } from "@hollowheap/runtime/lifecycle";
import { LockedProcessStore } from "@hollowheap/runtime/store";
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
}

export async function spawnShellTask(
  opts: SpawnShellTaskOptions,
): Promise<TaskRecord> {
  const id = opts.id ?? generateTaskId();
  const startedAt = Date.now();
  const shellBin = opts.shell ?? process.env.SHELL ?? "/bin/sh";
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
        shellBin,
        opts.command,
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

  if (meta.pid !== undefined) {
    await cancelProcessGroup(meta.pid, meta.startTime, graceMs);
    if (isProcessAlive(meta.pid, meta.startTime)) {
      return toTaskRecord(agentDir, meta);
    }
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
