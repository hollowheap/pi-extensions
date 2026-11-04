import { runBinary } from "@hollowheap/runtime/exec";

export function runCommand(
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  return runBinary(command, args, cwd, signal, { timeoutMs: 15_000 });
}
