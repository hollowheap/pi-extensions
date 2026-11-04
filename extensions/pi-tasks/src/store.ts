import { closeSync, openSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { readLog } from "@hollowheap/process/process";
import { type ProcessState, ProcessStore } from "@hollowheap/process/state";

const LOCK_TIMEOUT_MS = 1_000;
const STALE_LOCK_MS = 2_000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireStateLock(path: string): () => void {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      closeSync(openSync(path, "wx", 0o600));
      return () => {
        try {
          unlinkSync(path);
        } catch {
          // Another owner already removed a stale lock.
        }
      };
    } catch (error) {
      if ((error as { code?: unknown }).code !== "EEXIST") throw error;
    }
    try {
      if (Date.now() - statSync(path).mtimeMs > STALE_LOCK_MS) {
        try {
          unlinkSync(path);
        } catch {
          // A concurrent owner won the cleanup race.
        }
        continue;
      }
    } catch {
      // The lock disappeared; retry immediately.
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out acquiring task state lock: ${path}`);
    }
    sleepSync(5);
  }
}

export interface TaskStoreOptions<T extends ProcessState> {
  sanitize?: (state: T) => ProcessState;
}

export class TaskStore<T extends ProcessState = ProcessState> {
  readonly store: ProcessStore;
  private readonly sanitize: ((state: T) => ProcessState) | undefined;

  constructor(
    agentDir: string,
    subdir = "tasks",
    options: TaskStoreOptions<T> = {},
  ) {
    this.store = new ProcessStore(join(agentDir, subdir));
    this.sanitize = options.sanitize;
  }

  get dir(): string {
    return this.store.dir;
  }

  statePath(id: string): string {
    return this.store.statePath(id);
  }

  logPath(id: string): string {
    return this.store.logPath(id);
  }

  ensureLog(id: string): string {
    return this.store.ensureLog(id);
  }

  write(state: T): void {
    this.store.write(this.sanitize ? this.sanitize(state) : state);
  }

  update(id: string, patch: Partial<Omit<T, "id">>): T | undefined {
    return this.updateIf(id, () => true, patch);
  }

  updateIf(
    id: string,
    predicate: (current: T) => boolean,
    patch: Partial<Omit<T, "id">>,
  ): T | undefined {
    if (this.read(id) === undefined) return undefined;
    const release = acquireStateLock(`${this.statePath(id)}.lock`);
    try {
      const current = this.read(id);
      if (current === undefined) return undefined;
      if (!predicate(current)) return current;
      const next = { ...current, ...patch, id: current.id } as T;
      this.write(next);
      return next;
    } finally {
      release();
    }
  }

  read(id: string): T | undefined {
    return this.store.read(id) as T | undefined;
  }

  list(): T[] {
    return this.store.list() as unknown as T[];
  }

  log(id: string): string {
    try {
      return readLog(this.logPath(id));
    } catch {
      return "";
    }
  }
}
