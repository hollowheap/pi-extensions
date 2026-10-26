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

export interface ProcessState {
  id: string;
  status: string;
  pid?: number;
  startTime?: number;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number | null;
  [key: string]: unknown;
}

function sanitizeId(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid process id: ${id}`);
  }
  return id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidState(value: unknown): value is ProcessState {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.status === "string" &&
    typeof value.startedAt === "number"
  );
}

export class ProcessStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Best-effort on filesystems without POSIX modes.
    }
  }

  statePath(id: string): string {
    return join(this.dir, `${sanitizeId(id)}.json`);
  }

  logPath(id: string): string {
    return join(this.dir, `${sanitizeId(id)}.log`);
  }

  ensureLog(id: string): string {
    const path = this.logPath(id);
    if (!existsSync(path)) {
      writeFileSync(path, "", { mode: 0o600 });
    }
    try {
      chmodSync(path, 0o600);
    } catch {
      // Best-effort.
    }
    return path;
  }

  write(state: ProcessState): void {
    const target = this.statePath(state.id);
    const tmp = join(
      this.dir,
      `.${sanitizeId(state.id)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
    );
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // Best-effort.
    }
    renameSync(tmp, target);
  }

  read(id: string): ProcessState | undefined {
    let path: string;
    try {
      path = this.statePath(id);
    } catch {
      return undefined;
    }
    if (!existsSync(path)) return undefined;
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      return isValidState(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  list(): ProcessState[] {
    if (!existsSync(this.dir)) return [];
    const states: ProcessState[] = [];
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith(".json") || name.startsWith(".")) continue;
      const state = this.read(name.slice(0, -".json".length));
      if (state !== undefined) states.push(state);
    }
    states.sort(
      (a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id),
    );
    return states;
  }

  update(
    id: string,
    patch: Partial<Omit<ProcessState, "id">>,
  ): ProcessState | undefined {
    const current = this.read(id);
    if (current === undefined) return undefined;
    const next: ProcessState = { ...current, ...patch, id: current.id };
    this.write(next);
    return next;
  }
}
