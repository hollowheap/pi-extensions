import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isProcessAlive, readProcStartTime } from "@hollowheap/process";

export interface WriteLockOptions {
  timeoutMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
}

interface LockOwner {
  pid: number;
  startTime?: number;
  createdAt: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 25;
const MISSING_OWNER_GRACE_MS = 1_000;

function lockDir(agentDir: string): string {
  return join(agentDir, "subagents", "write.lock");
}

function ownerPath(agentDir: string): string {
  return join(lockDir(agentDir), "owner.json");
}

function readOwner(agentDir: string): LockOwner | undefined {
  try {
    const parsed = JSON.parse(
      readFileSync(ownerPath(agentDir), "utf8"),
    ) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as LockOwner).pid === "number" &&
      typeof (parsed as LockOwner).createdAt === "number"
    ) {
      return parsed as LockOwner;
    }
  } catch {
    // Missing or partial owner file.
  }
  return undefined;
}

function ownerAlive(owner: LockOwner): boolean {
  return isProcessAlive(owner.pid, owner.startTime);
}

function removeStaleLock(agentDir: string): void {
  try {
    rmSync(lockDir(agentDir), { recursive: true, force: true });
  } catch {
    // Another waiter may have removed it.
  }
}

function missingOwnerExpired(agentDir: string): boolean {
  try {
    return (
      Date.now() - statSync(lockDir(agentDir)).mtimeMs > MISSING_OWNER_GRACE_MS
    );
  } catch {
    return false;
  }
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

export async function acquireWriteLock(
  agentDir: string,
  options: WriteLockOptions = {},
): Promise<() => void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  const owner: LockOwner = {
    pid: process.pid,
    startTime: readProcStartTime(process.pid),
    createdAt: Date.now(),
  };

  while (true) {
    if (options.signal?.aborted) {
      throw new DOMException("write lock aborted", "AbortError");
    }
    mkdirSync(join(agentDir, "subagents"), { recursive: true, mode: 0o700 });
    try {
      mkdirSync(lockDir(agentDir), { mode: 0o700 });
      writeFileSync(ownerPath(agentDir), `${JSON.stringify(owner)}\n`, {
        mode: 0o600,
      });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const current = readOwner(agentDir);
        if (
          current?.pid === owner.pid &&
          current.createdAt === owner.createdAt
        ) {
          removeStaleLock(agentDir);
        }
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
    }

    const current = readOwner(agentDir);
    if (current !== undefined && !ownerAlive(current)) {
      removeStaleLock(agentDir);
      continue;
    }
    if (current === undefined && missingOwnerExpired(agentDir)) {
      removeStaleLock(agentDir);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error("timed out waiting for the write lock");
    }
    await sleep(pollMs, options.signal);
  }
}

export async function withWriteLock<T>(
  agentDir: string,
  operation: () => Promise<T> | T,
  options: WriteLockOptions = {},
): Promise<T> {
  const release = await acquireWriteLock(agentDir, options);
  try {
    return await operation();
  } finally {
    release();
  }
}
