import { execFile } from "node:child_process";
import { statSync } from "node:fs";

export function runCommand(
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      command,
      args,
      { cwd, timeout: 15000, signal },
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
  });
}
