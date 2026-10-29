import { type ChildProcess, spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
} from "node:fs";
import { dirname } from "node:path";

export interface SpawnDetachedOptions {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logPath: string;
}

export interface DetachedProcess {
  pid: number;
  startTime?: number;
  child: ChildProcess;
  logPath: string;
}

export interface WaitOptions {
  timeoutMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
}

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
    const value = Number.parseInt(fields[19] ?? "", 10);
    return Number.isFinite(value) ? value : undefined;
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
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM") return false;
  }
  if (expectedStartTime !== undefined) {
    const actual = readProcStartTime(pid);
    if (actual !== undefined && actual !== expectedStartTime) return false;
  }
  return true;
}

export function spawnDetachedProcess(
  options: SpawnDetachedOptions,
): DetachedProcess {
  mkdirSync(dirname(options.logPath), { recursive: true, mode: 0o700 });
  const logFd = openSync(options.logPath, "a", 0o600);
  try {
    chmodSync(options.logPath, 0o600);
    const child = spawn(options.command, [...(options.args ?? [])], {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    if (child.pid === undefined) {
      throw new Error(`failed to spawn detached process: ${options.command}`);
    }
    child.unref();
    return {
      pid: child.pid,
      startTime: readProcStartTime(child.pid),
      child,
      logPath: options.logPath,
    };
  } finally {
    closeSync(logFd);
  }
}

export function readLog(logPath: string): string {
  if (!existsSync(logPath)) return "";
  try {
    return readFileSync(logPath, "utf8");
  } catch {
    return "";
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

export async function waitForProcessExit(
  pid: number,
  startTime?: number,
  options: WaitOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollMs = options.pollMs ?? 50;
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (isProcessAlive(pid, startTime)) {
    if (options.signal?.aborted || Date.now() >= deadline) return false;
    await sleep(
      Math.min(pollMs, Math.max(1, deadline - Date.now())),
      options.signal,
    );
  }
  return true;
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    // Fall back to the leader if the process group is gone.
  }
  try {
    process.kill(pid, signal);
  } catch {
    // Already dead.
  }
}

export async function cancelProcessGroup(
  pid: number,
  startTime?: number,
  graceMs = 250,
): Promise<boolean> {
  if (!isProcessAlive(pid, startTime)) return false;
  signalProcessGroup(pid, "SIGTERM");
  if (await waitForProcessExit(pid, startTime, { timeoutMs: graceMs })) {
    return true;
  }
  signalProcessGroup(pid, "SIGKILL");
  await waitForProcessExit(pid, startTime, { timeoutMs: 1_000 });
  return true;
}

export async function isSocketConnectable(
  socketPath?: string,
  timeoutMs = 200,
): Promise<boolean> {
  if (socketPath === undefined) return true;
  const { existsSync } = await import("node:fs");
  if (!existsSync(socketPath)) return false;
  const { createConnection } = await import("node:net");
  return new Promise<boolean>((resolve) => {
    const socket = createConnection(socketPath) as unknown as {
      on: (e: string, cb: () => void) => void;
      destroy: () => void;
    };
    let settled = false;
    const done = (alive: boolean) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(alive);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
    setTimeout(() => done(false), timeoutMs);
  });
}
