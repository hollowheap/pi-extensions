import { execFile } from "node:child_process";
import { statSync } from "node:fs";

export interface RunOptions {
	okExitCodes?: readonly number[];
}

export function runBinary(
	command: string,
	args: string[],
	cwd: string,
	signal: AbortSignal | undefined,
	options: RunOptions = {},
): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		execFile(
			command,
			args,
			{ cwd, timeout: 30000, signal },
			(error, stdout, stderr) => {
				if (error === null) {
					resolvePromise(stdout);
					return;
				}
				const code = (error as NodeJS.ErrnoException).code;
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
					reject(
						new Error(`${command} is not installed (binary not found in PATH)`),
					);
					return;
				}
				if (
					typeof code === "number" &&
					(options.okExitCodes ?? []).includes(code)
				) {
					resolvePromise(stdout);
					return;
				}
				reject(
					new Error(
						`${command} failed: ${String(stderr || error.message).trim()}`,
					),
				);
			},
		);
	});
}

export function statMtimeMs(path: string): number | undefined {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return undefined;
	}
}

export function clampMaxResults(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return 100;
	return Math.min(Math.max(Math.trunc(value), 1), 500);
}

export interface ExecDeps {
	run: (
		command: string,
		args: string[],
		cwd: string,
		signal: AbortSignal | undefined,
		options?: RunOptions,
	) => Promise<string>;
	statMtimeMs: (path: string) => number | undefined;
}

export const defaultExecDeps: ExecDeps = { run: runBinary, statMtimeMs };
