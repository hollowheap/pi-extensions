import {
  DEFAULT_TUI_CONFIG,
  type TuiConfig,
  loadTuiConfig,
  normalizeTuiConfig,
} from "@hollowheap/core/tui-config";

const STATE_KEY = Symbol.for("@hollowheap/ui/state");

type TuiConfigListener = (config: TuiConfig) => void;

interface TuiStateStore {
  config: TuiConfig;
  listeners: Set<TuiConfigListener>;
  outputPadding?: () => 0 | 1 | undefined;
}

function cloneConfig(config: TuiConfig): TuiConfig {
  return {
    ...config,
    panel: {
      ...(config.panel ?? {}),
      customVerbs: { ...(config.panel?.customVerbs ?? {}) },
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
    listeners: new Set(),
  };
  globalStore[STATE_KEY] = created;
  return created;
}

function notifyListeners(store: TuiStateStore): void {
  const snapshot = [...store.listeners];
  for (const listener of snapshot) {
    listener(store.config);
  }
}

/** Return a copy of the currently active in-memory TUI configuration. */
export function getActiveTuiConfig(): TuiConfig {
  return cloneConfig(getStore().config);
}

/** Replace the active in-memory TUI configuration. */
export function setActiveTuiConfig(config: TuiConfig): void {
  const store = getStore();
  store.config = normalizeTuiConfig(config);
  notifyListeners(store);
}

/** Reset the active in-memory TUI configuration back to defaults. */
export function resetActiveTuiConfig(): void {
  const store = getStore();
  store.config = cloneConfig(DEFAULT_TUI_CONFIG);
  notifyListeners(store);
}

/** Subscribe to active config changes. Returns an unsubscribe function. */
export function subscribeActiveTuiConfig(
  listener: TuiConfigListener,
): () => void {
  const store = getStore();
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
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

/** Bind the current host settings while this extension session owns the TUI. */
export function bindHostOutputPadding(
  read: () => 0 | 1 | undefined,
): () => void {
  const store = getStore();
  store.outputPadding = read;
  return () => {
    if (store.outputPadding === read) store.outputPadding = undefined;
  };
}

export function getHostOutputPadding(): 0 | 1 | undefined {
  return getStore().outputPadding?.();
}
