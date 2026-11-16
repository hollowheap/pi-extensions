import {
  DEFAULT_TUI_CONFIG,
  type TuiConfig,
  loadTuiConfig,
  normalizeTuiConfig,
} from "@hollowheap/core/tui-config";

const STATE_KEY = Symbol.for("@hollowheap/tui/state");

interface TuiStateStore {
  config: TuiConfig;
}

function cloneConfig(config: TuiConfig): TuiConfig {
  return {
    ...config,
    toolBox: {
      ...config.toolBox,
      customVerbs: { ...config.toolBox.customVerbs },
    },
  };
}

function getStore(): TuiStateStore {
  const globalStore = globalThis as unknown as Record<
    symbol,
    TuiStateStore | undefined
  >;
  const existing = globalStore[STATE_KEY];
  if (existing !== undefined) return existing;
  const created: TuiStateStore = {
    config: cloneConfig(DEFAULT_TUI_CONFIG),
  };
  globalStore[STATE_KEY] = created;
  return created;
}

/** Return a copy of the currently active in-memory TUI configuration. */
export function getActiveTuiConfig(): TuiConfig {
  return cloneConfig(getStore().config);
}

/** Replace the active in-memory TUI configuration. */
export function setActiveTuiConfig(config: TuiConfig): void {
  getStore().config = normalizeTuiConfig(config);
}

/** Reset the active in-memory TUI configuration back to defaults. */
export function resetActiveTuiConfig(): void {
  getStore().config = cloneConfig(DEFAULT_TUI_CONFIG);
}

/** Load `tui.json` from `agentDir`, activate it in memory, and return it. */
export function loadAndActivateTuiConfig(
  agentDir: string,
  onDiagnostic?: (msg: string) => void,
): TuiConfig {
  const loaded = loadTuiConfig(agentDir, onDiagnostic);
  setActiveTuiConfig(loaded);
  return getActiveTuiConfig();
}
