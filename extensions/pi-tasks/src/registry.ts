import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { type ProcessState, ProcessStore, readLog } from "@hollowheap/process";

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

function store(agentDir: string): ProcessStore {
  return new ProcessStore(tasksDir(agentDir));
}

export function tasksDir(agentDir: string): string {
  return join(agentDir, "tasks");
}

export function ensureTasksDir(agentDir: string): string {
  return store(agentDir).dir;
}

export function generateTaskId(): string {
  return `task-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export function taskMetaPath(agentDir: string, id: string): string {
  return store(agentDir).statePath(id);
}

export function taskLogPath(agentDir: string, id: string): string {
  return store(agentDir).logPath(id);
}

export function writeTaskMetadata(agentDir: string, meta: TaskMetadata): void {
  store(agentDir).write(meta as unknown as ProcessState);
}

export function readTaskMetadata(
  agentDir: string,
  id: string,
): TaskMetadata | undefined {
  return store(agentDir).read(id) as TaskMetadata | undefined;
}

export function readTaskLog(agentDir: string, id: string): string {
  try {
    return readLog(taskLogPath(agentDir, id));
  } catch {
    return "";
  }
}

export function listTaskMetadata(agentDir: string): TaskMetadata[] {
  return store(agentDir).list() as unknown as TaskMetadata[];
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
  const processStore = store(agentDir);
  processStore.ensureLog(meta.id);
  processStore.write(meta as unknown as ProcessState);
  return toTaskRecord(agentDir, meta, ops);
}
