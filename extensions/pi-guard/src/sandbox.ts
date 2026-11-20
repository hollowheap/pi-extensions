import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  type BashOperations,
  createLocalBashOperations,
} from "@earendil-works/pi-coding-agent";
import {
  type SandboxOptions,
  wrapSandboxCommand,
} from "@hollowheap/runtime/sandbox";

export function createSandboxedBashOperations(
  resolveSandbox: () => boolean | SandboxOptions | undefined,
  resolveAgentDir: () => string,
): BashOperations {
  const local = createLocalBashOperations();
  return {
    async exec(command, cwd, options) {
      const sandbox = resolveSandbox();
      if (!sandbox) {
        return local.exec(command, cwd, options);
      }

      const agentDir = resolve(resolveAgentDir());
      mkdirSync(agentDir, { recursive: true, mode: 0o700 });
      const baseOpts: SandboxOptions =
        typeof sandbox === "object" ? sandbox : {};
      const sandboxOpts: SandboxOptions = {
        ...baseOpts,
        cwd: baseOpts.cwd ?? cwd,
        writablePaths: [...(baseOpts.writablePaths ?? []), agentDir],
      };

      const wrapped = wrapSandboxCommand("sh", ["-c", command], sandboxOpts);
      return await new Promise<{ exitCode: number | null }>((res, rej) => {
        const child = spawn(wrapped.command, wrapped.args, {
          cwd,
          env: options.env ?? process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let timedOut = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (options.timeout !== undefined && options.timeout > 0) {
          timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, options.timeout * 1000);
        }

        const onAbort = () => {
          child.kill("SIGKILL");
        };
        if (options.signal) {
          if (options.signal.aborted) {
            onAbort();
          } else {
            options.signal.addEventListener("abort", onAbort, { once: true });
          }
        }

        const cleanup = () => {
          if (timer !== undefined) clearTimeout(timer);
          options.signal?.removeEventListener("abort", onAbort);
        };

        child.stdout?.on("data", (chunk: Buffer) => options.onData(chunk));
        child.stderr?.on("data", (chunk: Buffer) => options.onData(chunk));
        child.on("error", (err) => {
          cleanup();
          rej(err);
        });
        child.on("close", (code, signal) => {
          cleanup();
          if (timedOut) {
            rej(new Error(`timeout:${options.timeout}`));
            return;
          }
          if (options.signal?.aborted) {
            rej(new Error("aborted"));
            return;
          }
          if (code !== null) {
            res({ exitCode: code });
            return;
          }
          res({ exitCode: signal ? 128 : null });
        });
      });
    },
  };
}
