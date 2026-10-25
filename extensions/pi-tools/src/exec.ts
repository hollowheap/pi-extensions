import { statSync } from "node:fs";
import { type RunOptions, clampMaxResults, runBinary } from "@hollowheap/core";

export { type RunOptions, clampMaxResults, runBinary };

export function statMtimeMs(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
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
