import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export type TaskKind = "shell" | "subagent";
export type TaskStatus = "running" | "completed" | "failed" | "cancelled";

export interface TaskMetadata {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  command?: string;
  cwd: string;
  pid?: number;
  startTime?: number;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number | null;
}

export interface TaskRecord extends TaskMetadata {
  output: () => Promise<string>;
  wait: (timeoutMs?: number, signal?: AbortSignal) => Promise<TaskRecord>;
  cancel: () => Promise<TaskRecord>;
}

export interface TaskOperations {
  wait?: (
    agentDir: string,
    id: string,
    timeoutMs?: number,
    signal?: AbortSignal,
  ) => Promise<TaskRecord>;
  cancel?: (agentDir: string, id: string) => Promise<TaskRecord>;
}

export function tasksDir(agentDir: string): string {
  return join(agentDir, "tasks");
}

export function ensureTasksDir(agentDir: string): string {
  const dir = tasksDir(agentDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Best-effort chmod on platforms/filesystems that support POSIX modes.
  }
  return dir;
}

export function generateTaskId(): string {
  return `task-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

function sanitizeTaskId(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid task id: ${id}`);
  }
  return id;
}

export function taskMetaPath(agentDir: string, id: string): string {
  return join(tasksDir(agentDir), `${sanitizeTaskId(id)}.json`);
}

export function taskLogPath(agentDir: string, id: string): string {
  return join(tasksDir(agentDir), `${sanitizeTaskId(id)}.log`);
}

export function writeTaskMetadata(agentDir: string, meta: TaskMetadata): void {
  const dir = ensureTasksDir(agentDir);
  const target = taskMetaPath(agentDir, meta.id);
  const tmp = join(
    dir,
    `.${sanitizeTaskId(meta.id)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  writeFileSync(tmp, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, target);
}

export function readTaskMetadata(
  agentDir: string,
  id: string,
): TaskMetadata | undefined {
  let path: string;
  try {
    path = taskMetaPath(agentDir, id);
  } catch {
    return undefined;
  }
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as TaskMetadata;
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string")
      return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

export function readTaskLog(agentDir: string, id: string): string {
  let path: string;
  try {
    path = taskLogPath(agentDir, id);
  } catch {
    return "";
  }
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export function listTaskMetadata(agentDir: string): TaskMetadata[] {
  const dir = tasksDir(agentDir);
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir);
  const items: TaskMetadata[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const id = name.slice(0, -".json".length);
    const meta = readTaskMetadata(agentDir, id);
    if (meta) items.push(meta);
  }
  items.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  return items;
}

export function toTaskRecord(
  agentDir: string,
  meta: TaskMetadata,
  ops?: TaskOperations,
): TaskRecord {
  const record: TaskRecord = {
    ...meta,
    output: async () => readTaskLog(agentDir, meta.id),
    wait: async (timeoutMs?: number, signal?: AbortSignal) => {
      if (ops?.wait) return ops.wait(agentDir, meta.id, timeoutMs, signal);
      const latest = readTaskMetadata(agentDir, meta.id) ?? meta;
      return toTaskRecord(agentDir, latest, ops);
    },
    cancel: async () => {
      if (ops?.cancel) return ops.cancel(agentDir, meta.id);
      const updated: TaskMetadata = {
        ...(readTaskMetadata(agentDir, meta.id) ?? meta),
        status: "cancelled",
        finishedAt: Date.now(),
      };
      writeTaskMetadata(agentDir, updated);
      return toTaskRecord(agentDir, updated, ops);
    },
  };
  return record;
}

export function createTaskRecord(
  agentDir: string,
  meta: TaskMetadata,
  ops?: TaskOperations,
): TaskRecord {
  ensureTasksDir(agentDir);
  const log = taskLogPath(agentDir, meta.id);
  if (!existsSync(log)) {
    writeFileSync(log, "", { mode: 0o600 });
  }
  chmodSync(log, 0o600);
  writeTaskMetadata(agentDir, meta);
  return toTaskRecord(agentDir, meta, ops);
}
