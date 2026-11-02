export interface UpstreamActivity {
  currentTool?: string;
  currentToolStartedAt?: number;
}

export interface UpstreamRun {
  id: string;
  label?: string;
  agent?: string;
  state: string;
  startedAt: number;
  activity?: UpstreamActivity;
}

export interface UpstreamSnapshot {
  runs?: readonly UpstreamRun[];
}

export interface ImportedSubagentItem {
  id: string;
  agent: string;
  task: string;
  state: string;
  startedAt: number;
  activeTool?: string;
  activeToolStartedAt?: number;
}

const ACTIVE_STATES: Record<string, string> = {
  queued: "starting",
  pending: "starting",
  starting: "starting",
  running: "running",
};

export function mapUpstreamRuns(
  input: readonly UpstreamRun[] | UpstreamSnapshot | undefined,
): ImportedSubagentItem[] {
  const runs: readonly UpstreamRun[] = Array.isArray(input)
    ? (input as readonly UpstreamRun[])
    : ((input as UpstreamSnapshot | undefined)?.runs ?? []);
  const mapped: ImportedSubagentItem[] = [];
  for (const run of runs) {
    const state = ACTIVE_STATES[run.state];
    if (state === undefined) continue;
    mapped.push({
      id: run.id,
      agent: run.agent ?? run.label ?? "upstream",
      task: "",
      state,
      startedAt: run.startedAt,
      ...(run.activity?.currentTool !== undefined
        ? { activeTool: run.activity.currentTool }
        : {}),
      ...(run.activity?.currentToolStartedAt !== undefined
        ? { activeToolStartedAt: run.activity.currentToolStartedAt }
        : {}),
    });
  }
  return mapped;
}
