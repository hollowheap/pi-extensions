import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { type SandboxOptions, wrapSandboxCommand } from "./sandbox.js";

export interface RunOptions {
  okExitCodes?: readonly number[];
  maxBuffer?: number;
  timeoutMs?: number;
  sandbox?: boolean | SandboxOptions;
}

export interface CaptureOptions {
  input?: string;
  maxBuffer?: number;
  timeoutMs?: number;
  sandbox?: boolean | SandboxOptions;
}

export interface CaptureResult {
  code: number;
  stdout: string;
  stderr: string;
}

const DEFAULT_MAX_BUFFER = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export function clampMaxResults(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 100;
  return Math.min(Math.max(Math.trunc(value), 1), 500);
}

/**
 * Runs a command and reports how it ended instead of throwing on a nonzero
 * exit, so callers can tell "the command decided" from "the command failed".
 */
export function runCapture(
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
  options: CaptureOptions = {},
): Promise<CaptureResult> {
  return new Promise((resolvePromise, reject) => {
    let targetCommand = command;
    let targetArgs = args;

    if (options.sandbox) {
      try {
        const sandboxOpts: SandboxOptions =
          typeof options.sandbox === "object" ? options.sandbox : {};
        const wrapped = wrapSandboxCommand(command, args, {
          cwd,
          ...sandboxOpts,
        });
        targetCommand = wrapped.command;
        targetArgs = wrapped.args;
      } catch (err) {
        reject(err);
        return;
      }
    }

    if (signal?.aborted) {
      reject(new Error(`${command} failed: The operation was aborted`));
      return;
    }

    const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const child = spawn(targetCommand, targetArgs, {
      cwd,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let settled = false;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const killChildGroup = (sig: NodeJS.Signals = "SIGTERM") => {
      const pid = child.pid;
      if (pid === undefined) return;
      try {
        process.kill(-pid, sig);
        return;
      } catch {
        // Fall back to the leader if the process group is gone.
      }
      try {
        process.kill(pid, sig);
      } catch {
        // Already dead.
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onAbort = () => {
      killChildGroup("SIGTERM");
      fail(new Error(`${command} failed: The operation was aborted`));
    };

    const timer = setTimeout(() => {
      killChildGroup("SIGTERM");
      fail(
        new Error(
          `${command} failed: ${String(stderr || `timed out after ${timeoutMs}ms`).trim()}`,
        ),
      );
    }, timeoutMs);

    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > maxBuffer) {
        killChildGroup("SIGTERM");
        fail(new Error(`${command} failed: stdout maxBuffer length exceeded`));
        return;
      }
      stdout += chunk.toString("utf8");
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > maxBuffer) {
        killChildGroup("SIGTERM");
        fail(new Error(`${command} failed: stderr maxBuffer length exceeded`));
        return;
      }
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        try {
          statSync(cwd);
        } catch {
          fail(
            new Error(
              `${command} failed: working directory does not exist: ${cwd}`,
            ),
          );
          return;
        }
        fail(new Error(`command not found: ${command}`));
        return;
      }
      fail(
        new Error(
          `${command} failed: ${String(stderr || error.message).trim()}`,
        ),
      );
    });

    child.on("close", (code, exitSignal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (typeof code === "number") {
        resolvePromise({ code, stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} failed: ${String(stderr || `terminated by ${exitSignal ?? "signal"}`).trim()}`,
        ),
      );
    });

    // A child that reads stdin must see the end of it, or it waits forever.
    child.stdin?.on("error", () => {});
    child.stdin?.end(options.input ?? "");
  });
}

export async function runBinary(
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
  options: RunOptions = {},
): Promise<string> {
  const result = await runCapture(command, args, cwd, signal, options);
  if (result.code === 0 || (options.okExitCodes ?? []).includes(result.code)) {
    return result.stdout;
  }
  throw new Error(
    `${command} failed: ${String(result.stderr || `exit code ${result.code}`).trim()}`,
  );
}
