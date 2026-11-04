import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { ProcessState } from "@hollowheap/runtime";
import { LockedProcessStore } from "@hollowheap/runtime/store";

export type TaskKind = "shell";
export type TaskStatus = "running" | "completed" | "failed" | "cancelled";

export interface TaskMetadata extends ProcessState {
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
  dependsOn?: string[];
}

export interface TaskRecord extends TaskMetadata {
  output: () => Promise<string>;
}

function store(agentDir: string): LockedProcessStore<TaskMetadata> {
  return new LockedProcessStore<TaskMetadata>(agentDir);
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
  store(agentDir).write(meta);
}

function isTaskMetadata(value: unknown): value is TaskMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.kind === "shell" &&
    (record.status === "running" ||
      record.status === "completed" ||
      record.status === "failed" ||
      record.status === "cancelled") &&
    typeof record.cwd === "string" &&
    typeof record.startedAt === "number" &&
    Number.isFinite(record.startedAt)
  );
}

export function readTaskMetadata(
  agentDir: string,
  id: string,
): TaskMetadata | undefined {
  const metadata = store(agentDir).read(id);
  return isTaskMetadata(metadata) ? metadata : undefined;
}

export function readTaskLog(agentDir: string, id: string): string {
  return store(agentDir).log(id);
}

export function listTaskMetadata(agentDir: string): TaskMetadata[] {
  return store(agentDir).list().filter(isTaskMetadata);
}

export function toTaskRecord(agentDir: string, meta: TaskMetadata): TaskRecord {
  return {
    ...meta,
    output: async () => readTaskLog(agentDir, meta.id),
  };
}

export function createTaskRecord(
  agentDir: string,
  meta: TaskMetadata,
): TaskRecord {
  const processStore = store(agentDir);
  processStore.ensureLog(meta.id);
  processStore.write(meta);
  return toTaskRecord(agentDir, meta);
}
