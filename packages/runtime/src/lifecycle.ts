import {
  type DetachedProcess,
  signalProcessGroup,
  spawnDetachedProcess,
} from "./process.js";
import type { SandboxOptions } from "./sandbox.js";
import type { ProcessState } from "./state.js";
import type { LockedProcessStore } from "./store.js";

export interface SpawnDetachedTaskOptions<T extends ProcessState> {
  store: LockedProcessStore<T>;
  state: T;
  command: string;
  args?: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  logPath?: string;
  sandbox?: boolean | SandboxOptions;
  patch?: (spawned: DetachedProcess) => Partial<Omit<T, "id">>;
}

export function spawnDetachedTask<T extends ProcessState>(
  options: SpawnDetachedTaskOptions<T>,
): DetachedProcess {
  const logPath = options.logPath ?? options.store.logPath(options.state.id);
  options.store.write(options.state);
  const spawned = spawnDetachedProcess({
    command: options.command,
    args: options.args,
    cwd: options.cwd,
    env: options.env,
    logPath,
    sandbox: options.sandbox,
  });
  const patch =
    options.patch?.(spawned) ??
    ({
      pid: spawned.pid,
      ...(spawned.startTime !== undefined
        ? { startTime: spawned.startTime }
        : {}),
    } as unknown as Partial<Omit<T, "id">>);
  try {
    options.store.update(options.state.id, patch);
  } catch (error) {
    signalProcessGroup(spawned.pid, "SIGKILL");
    try {
      options.store.update(options.state.id, {
        status: "failed",
        exitCode: null,
        finishedAt: Date.now(),
      } as unknown as Partial<Omit<T, "id">>);
    } catch {
      // The original update failure is the actionable one.
    }
    throw error;
  }
  return spawned;
}
