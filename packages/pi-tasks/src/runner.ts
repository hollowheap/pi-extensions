import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  type TaskMetadata,
  type TaskOperations,
  type TaskRecord,
  createTaskRecord,
  generateTaskId,
  listTaskMetadata,
  readTaskMetadata,
  taskLogPath,
  taskMetaPath,
  toTaskRecord,
  writeTaskMetadata,
} from "./registry.js";

const SHIM_SCRIPT = `
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { chmodSync, openSync, closeSync, readFileSync, renameSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const [metaPath, logPath, cwd, shellBin, command] = process.argv.slice(1);

function readStartTime(pid) {
  try {
    const stat = readFileSync("/proc/" + pid + "/stat", "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen < 0) return undefined;
    const fields = stat.slice(closeParen + 2).trim().split(/\\s+/);
    const val = Number.parseInt(fields[19] ?? "", 10);
    return Number.isFinite(val) ? val : undefined;
  } catch {
    return undefined;
  }
}

function updateMeta(patch) {
  try {
    const raw = JSON.parse(readFileSync(metaPath, "utf8"));
    if (raw.status === "cancelled" && patch.status !== "cancelled") return;
    const next = { ...raw, ...patch };
    const tmp = join(dirname(metaPath), "." + raw.id + "." + process.pid + "." + randomBytes(4).toString("hex") + ".tmp");
    writeFileSync(tmp, JSON.stringify(next, null, 2) + "\\n", { mode: 0o600 });
    try { chmodSync(tmp, 0o600); } catch {}
    renameSync(tmp, metaPath);
  } catch {}
}

let logFd;
try {
  logFd = openSync(logPath, "a", 0o600);
  try { chmodSync(logPath, 0o600); } catch {}
} catch {
  updateMeta({ status: "failed", exitCode: null, finishedAt: Date.now() });
  process.exit(1);
}

const selfStart = readStartTime(process.pid);
updateMeta({ pid: process.pid, ...(selfStart !== undefined ? { startTime: selfStart } : {}) });

const child = spawn(shellBin, ["-c", command], {
  cwd,
  stdio: ["ignore", logFd, logFd],
});

const forwardSignal = (sig) => {
  try { child.kill(sig); } catch {}
};
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
process.on("SIGINT", () => forwardSignal("SIGINT"));

child.on("error", (err) => {
  try {
    writeFileSync(logFd, (err && err.message ? err.message : String(err)) + "\\n");
  } catch {}
  try { closeSync(logFd); } catch {}
  updateMeta({ status: "failed", exitCode: null, finishedAt: Date.now() });
  process.exit(1);
});

child.on("close", (code) => {
  try { closeSync(logFd); } catch {}
  const exitCode = typeof code === "number" ? code : null;
  const status = exitCode === 0 ? "completed" : "failed";
  updateMeta({ status, exitCode, finishedAt: Date.now() });
  process.exit(0);
});
`;

export function readProcStartTime(pid: number): number | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen < 0) return undefined;
    const fields = stat
      .slice(closeParen + 2)
      .trim()
      .split(/\s+/);
    const val = Number.parseInt(fields[19] ?? "", 10);
    return Number.isFinite(val) ? val : undefined;
  } catch {
    return undefined;
  }
}

export function isProcessAlive(
  pid?: number,
  expectedStartTime?: number,
): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "EPERM") return false;
  }
  if (expectedStartTime !== undefined) {
    const actualStartTime = readProcStartTime(pid);
    if (
      actualStartTime !== undefined &&
      actualStartTime !== expectedStartTime
    ) {
      return false;
    }
  }
  return true;
}

const runnerOps: TaskOperations = {
  wait: async (agentDir, id, timeoutMs, signal) => {
    const record = await waitForTask(agentDir, id, timeoutMs, signal);
    if (!record) throw new Error(`Task not found: ${id}`);
    return record;
  },
  cancel: async (agentDir, id) => {
    const record = await cancelTask(agentDir, id);
    if (!record) throw new Error(`Task not found: ${id}`);
    return record;
  },
};

export function reconcileTask(
  agentDir: string,
  id: string,
): TaskRecord | undefined {
  const meta = readTaskMetadata(agentDir, id);
  if (!meta) return undefined;
  if (meta.status === "running") {
    if (!isProcessAlive(meta.pid, meta.startTime)) {
      const latest = readTaskMetadata(agentDir, id);
      if (latest && latest.status !== "running") {
        return toTaskRecord(agentDir, latest, runnerOps);
      }
      const updated: TaskMetadata = {
        ...meta,
        status: "failed",
        exitCode: null,
        finishedAt: Date.now(),
      };
      writeTaskMetadata(agentDir, updated);
      return toTaskRecord(agentDir, updated, runnerOps);
    }
  }
  return toTaskRecord(agentDir, meta, runnerOps);
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
  };
  createTaskRecord(opts.agentDir, initialMeta, runnerOps);

  const metaPath = taskMetaPath(opts.agentDir, id);
  const logPath = taskLogPath(opts.agentDir, id);

  const shim = spawn(
    process.execPath,
    ["-e", SHIM_SCRIPT, metaPath, logPath, opts.cwd, shellBin, opts.command],
    {
      cwd: opts.cwd,
      detached: true,
      stdio: "ignore",
    },
  );
  shim.unref();

  const pid = shim.pid;
  const startTime = pid !== undefined ? readProcStartTime(pid) : undefined;
  const current = readTaskMetadata(opts.agentDir, id) ?? initialMeta;
  if (current.status === "running" && pid !== undefined) {
    const updated: TaskMetadata = {
      ...current,
      pid,
      ...(startTime !== undefined ? { startTime } : {}),
    };
    writeTaskMetadata(opts.agentDir, updated);
    return toTaskRecord(opts.agentDir, updated, runnerOps);
  }
  return toTaskRecord(opts.agentDir, current, runnerOps);
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

function killProcessGroupOrPid(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(-pid, sig);
    return;
  } catch {
    // Fallback to direct pid if process group kill fails.
  }
  try {
    process.kill(pid, sig);
  } catch {
    // Already dead.
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
    return toTaskRecord(agentDir, meta, runnerOps);
  }

  if (meta.pid !== undefined && isProcessAlive(meta.pid, meta.startTime)) {
    killProcessGroupOrPid(meta.pid, "SIGTERM");
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline && isProcessAlive(meta.pid, meta.startTime)) {
      await sleep(20);
    }
    if (isProcessAlive(meta.pid, meta.startTime)) {
      killProcessGroupOrPid(meta.pid, "SIGKILL");
    }
  }

  const cancelled: TaskMetadata = {
    ...meta,
    status: "cancelled",
    finishedAt: Date.now(),
  };
  writeTaskMetadata(agentDir, cancelled);
  return toTaskRecord(agentDir, cancelled, runnerOps);
}
