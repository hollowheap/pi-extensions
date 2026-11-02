import type { ProcessState } from "@hollowheap/process";
import {
  type DetachedProcess,
  spawnDetachedProcess,
} from "@hollowheap/process";
import type { TaskStore } from "./store.js";

export interface SpawnDetachedTaskOptions<T extends ProcessState> {
  store: TaskStore<T>;
  state: T;
  command: string;
  args?: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  logPath?: string;
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
  } catch {
    // The shim still owns the process; callers can reconcile from state.
  }
  return spawned;
}
