import { type ChildProcess, execFileSync, spawn } from "node:child_process";
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

function readPsStartTime(pid: number): number | undefined {
  try {
    const output = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 1_000,
    }).trim();
    const parsed = Date.parse(output);
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Process start identity: /proc clock ticks on Linux, epoch ms via ps elsewhere. */
export function readProcStartTime(pid: number): number | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen < 0) return readPsStartTime(pid);
    const fields = stat
      .slice(closeParen + 2)
      .trim()
      .split(/\s+/);
    const value = Number.parseInt(fields[19] ?? "", 10);
    return Number.isFinite(value) ? value : readPsStartTime(pid);
  } catch {
    return readPsStartTime(pid);
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
    // Avoid an unhandled error event when a spawn fails asynchronously.
    child.on("error", () => {});
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

function isProcessGroupAlive(pid: number): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

function signalProcessGroup(
  pid: number,
  signal: NodeJS.Signals,
  leaderAlive = true,
): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    // Fall back to the leader if the process group is gone.
  }
  if (!leaderAlive) return false;
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    // Already dead.
    return false;
  }
}

export async function cancelProcessGroup(
  pid: number,
  startTime?: number,
  graceMs = 250,
): Promise<boolean> {
  const leaderAlive = isProcessAlive(pid, startTime);
  if (!signalProcessGroup(pid, "SIGTERM", leaderAlive)) return false;
  const deadline = Date.now() + Math.max(0, graceMs);
  while (isProcessAlive(pid, startTime) || isProcessGroupAlive(pid)) {
    if (Date.now() >= deadline) break;
    await sleep(Math.min(50, Math.max(1, deadline - Date.now())));
  }
  if (!isProcessAlive(pid, startTime) && !isProcessGroupAlive(pid)) {
    return true;
  }
  signalProcessGroup(pid, "SIGKILL", isProcessAlive(pid, startTime));
  const killDeadline = Date.now() + 1_000;
  while (isProcessAlive(pid, startTime) || isProcessGroupAlive(pid)) {
    if (Date.now() >= killDeadline) break;
    await sleep(Math.min(50, Math.max(1, killDeadline - Date.now())));
  }
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
