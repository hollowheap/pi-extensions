import { join } from "node:path";
import type { ProcessState } from "@hollowheap/runtime";
import { LockedProcessStore } from "@hollowheap/runtime/store";

export const SUBAGENTS_DIR = "subagents";

export type SubagentStatus =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface SubagentState extends ProcessState {
  status: SubagentStatus;
  agent: string;
  task: string;
  depth: number;
  attempt: number;
  parentSession?: string;
  runnerPid?: number;
  runnerStartTime?: number;
  harness?: string;
  inputMode?: "jsonl" | "text";
  socket?: string;
  session?: string;
  model?: string;
  activeTool?: string;
  activeToolStartedAt?: number;
}

export function subagentsDir(agentDir: string): string {
  return join(agentDir, SUBAGENTS_DIR);
}

export function requireTrustedProject(trusted: boolean): void {
  if (!trusted) {
    throw new Error("subagent requires a trusted project");
  }
}

function sanitize(state: SubagentState): ProcessState {
  return {
    id: state.id,
    status: state.status,
    startedAt: state.startedAt,
    agent: state.agent,
    task: state.task,
    depth: state.depth,
    attempt: state.attempt,
    ...(state.parentSession !== undefined
      ? { parentSession: state.parentSession }
      : {}),
    ...(state.pid !== undefined ? { pid: state.pid } : {}),
    ...(state.startTime !== undefined ? { startTime: state.startTime } : {}),
    ...(state.runnerPid !== undefined ? { runnerPid: state.runnerPid } : {}),
    ...(state.runnerStartTime !== undefined
      ? { runnerStartTime: state.runnerStartTime }
      : {}),
    ...(state.harness !== undefined ? { harness: state.harness } : {}),
    ...(state.inputMode !== undefined ? { inputMode: state.inputMode } : {}),
    ...(state.finishedAt !== undefined ? { finishedAt: state.finishedAt } : {}),
    ...(state.exitCode !== undefined ? { exitCode: state.exitCode } : {}),
    ...(state.socket !== undefined ? { socket: state.socket } : {}),
    ...(state.session !== undefined ? { session: state.session } : {}),
    ...(state.model !== undefined ? { model: state.model } : {}),
    ...(state.activeTool !== undefined ? { activeTool: state.activeTool } : {}),
    ...(state.activeToolStartedAt !== undefined
      ? { activeToolStartedAt: state.activeToolStartedAt }
      : {}),
  };
}

export class SubagentStore {
  readonly store: LockedProcessStore<SubagentState>;

  constructor(agentDir: string) {
    this.store = new LockedProcessStore<SubagentState>(
      agentDir,
      SUBAGENTS_DIR,
      {
        sanitize,
      },
    );
  }

  get dir(): string {
    return this.store.dir;
  }

  statePath(id: string): string {
    return this.store.statePath(id);
  }

  logPath(id: string): string {
    return this.store.logPath(id);
  }

  socketPath(id: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error(`Invalid subagent id: ${id}`);
    }
    return join(this.dir, `${id}.sock`);
  }

  ensureLog(id: string): string {
    return this.store.ensureLog(id);
  }

  write(state: SubagentState): void {
    this.store.write(state);
  }

  update(
    id: string,
    patch: Partial<Omit<SubagentState, "id">>,
  ): SubagentState | undefined {
    return this.store.update(id, patch);
  }

  updateIf(
    id: string,
    predicate: (current: SubagentState) => boolean,
    patch: Partial<Omit<SubagentState, "id">>,
  ): SubagentState | undefined {
    return this.store.updateIf(id, predicate, patch);
  }

  read(id: string): SubagentState | undefined {
    return this.store.read(id);
  }

  list(): SubagentState[] {
    return this.store.list();
  }

  log(id: string): string {
    return this.store.log(id);
  }
}
