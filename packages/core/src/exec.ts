import { execFile } from "node:child_process";
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

    const child = execFile(
      targetCommand,
      targetArgs,
      {
        cwd,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        signal,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolvePromise({ code: 0, stdout, stderr });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (typeof code === "number") {
          resolvePromise({ code, stdout, stderr });
          return;
        }
        if (code === "ENOENT") {
          try {
            statSync(cwd);
          } catch {
            reject(
              new Error(
                `${command} failed: working directory does not exist: ${cwd}`,
              ),
            );
            return;
          }
          reject(new Error(`command not found: ${command}`));
          return;
        }
        reject(
          new Error(
            `${command} failed: ${String(stderr || error.message).trim()}`,
          ),
        );
      },
    );
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
