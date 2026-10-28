import { join } from "node:path";
import { type ProcessState, ProcessStore, readLog } from "@hollowheap/process";

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
    ...(state.pid !== undefined ? { pid: state.pid } : {}),
    ...(state.startTime !== undefined ? { startTime: state.startTime } : {}),
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
  readonly store: ProcessStore;

  constructor(agentDir: string) {
    this.store = new ProcessStore(subagentsDir(agentDir));
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
    this.store.write(sanitize(state));
  }

  update(
    id: string,
    patch: Partial<Omit<SubagentState, "id">>,
  ): SubagentState | undefined {
    const current = this.read(id);
    if (current === undefined) return undefined;
    const next: SubagentState = { ...current, ...patch, id: current.id };
    this.write(next);
    return next;
  }

  read(id: string): SubagentState | undefined {
    return this.store.read(id) as SubagentState | undefined;
  }

  list(): SubagentState[] {
    return this.store.list() as unknown as SubagentState[];
  }

  log(id: string): string {
    try {
      return readLog(this.logPath(id));
    } catch {
      return "";
    }
  }
}
