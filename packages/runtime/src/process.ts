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
import { type SandboxOptions, wrapSandboxCommand } from "./sandbox.js";

export interface SpawnDetachedOptions {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logPath: string;
  sandbox?: boolean | SandboxOptions;
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
    if (actual !== expectedStartTime) return false;
  }
  return true;
}

function isStaleProcessIdentity(pid: number, startTime?: number): boolean {
  if (startTime === undefined) return false;
  return isProcessAlive(pid) && !isProcessAlive(pid, startTime);
}

export function spawnDetachedProcess(
  options: SpawnDetachedOptions,
): DetachedProcess {
  let spawnCommand = options.command;
  let spawnArgs = [...(options.args ?? [])];
  if (options.sandbox) {
    const sandboxOpts: SandboxOptions =
      typeof options.sandbox === "object"
        ? { ...options.sandbox, cwd: options.sandbox.cwd ?? options.cwd }
        : { cwd: options.cwd };
    const wrapped = wrapSandboxCommand(options.command, spawnArgs, sandboxOpts);
    spawnCommand = wrapped.command;
    spawnArgs = wrapped.args;
  }
  mkdirSync(dirname(options.logPath), { recursive: true, mode: 0o700 });
  const logFd = openSync(options.logPath, "a", 0o600);
  try {
    chmodSync(options.logPath, 0o600);
    const child = spawn(spawnCommand, spawnArgs, {
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

function isProcessGroupAlive(pid: number, startTime?: number): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (isStaleProcessIdentity(pid, startTime)) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

export function signalProcessGroup(
  pid: number,
  signal: NodeJS.Signals,
  leaderAlive = true,
  startTime?: number,
): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (isStaleProcessIdentity(pid, startTime)) return false;
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

export interface TerminateGroupOptions {
  startTime?: number;
  graceMs?: number;
  killWaitMs?: number;
}

/**
 * Terminates a detached process group with SIGTERM then SIGKILL, and reports
 * whether the leader and group are actually gone. Shared by every cancel path
 * so escalation cannot drift between them.
 */
export async function terminateProcessGroup(
  pid: number,
  options: TerminateGroupOptions = {},
): Promise<boolean> {
  const { startTime, graceMs = 250, killWaitMs = 1_000 } = options;
  const alive = () =>
    isProcessAlive(pid, startTime) || isProcessGroupAlive(pid, startTime);
  if (!alive()) return false;
  signalProcessGroup(pid, "SIGTERM", isProcessAlive(pid, startTime), startTime);
  const graceDeadline = Date.now() + Math.max(0, graceMs);
  while (alive()) {
    if (Date.now() >= graceDeadline) break;
    await sleep(Math.min(50, Math.max(1, graceDeadline - Date.now())));
  }
  if (!alive()) return true;
  signalProcessGroup(pid, "SIGKILL", isProcessAlive(pid, startTime), startTime);
  const killDeadline = Date.now() + Math.max(0, killWaitMs);
  while (alive()) {
    if (Date.now() >= killDeadline) break;
    await sleep(Math.min(50, Math.max(1, killDeadline - Date.now())));
  }
  return !alive();
}

export async function cancelProcessGroup(
  pid: number,
  startTime?: number,
  graceMs = 250,
  killWaitMs = 1_000,
): Promise<boolean> {
  return terminateProcessGroup(pid, { startTime, graceMs, killWaitMs });
}

export interface TerminateProcessGroupsOptions {
  graceMs?: number;
  killWaitMs?: number;
}

export async function terminateProcessGroups(
  groups: readonly { pid: number; startTime?: number }[],
  options: TerminateProcessGroupsOptions = {},
): Promise<boolean> {
  let terminatedAll = true;
  for (const group of groups) {
    const terminated = await terminateProcessGroup(group.pid, {
      startTime: group.startTime,
      graceMs: options.graceMs,
      killWaitMs: options.killWaitMs,
    });
    // A valid group which exited before signaling also satisfies teardown.
    if (
      !terminated &&
      (!Number.isInteger(group.pid) ||
        group.pid <= 0 ||
        isProcessAlive(group.pid, group.startTime) ||
        isProcessGroupAlive(group.pid, group.startTime) ||
        (group.startTime !== undefined &&
          isProcessAlive(group.pid) &&
          readProcStartTime(group.pid) === undefined))
    ) {
      terminatedAll = false;
    }
  }
  return terminatedAll;
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
