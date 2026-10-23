import type { ModeEnter, ModeLayer, ModeSource } from "./types.js";

export interface SessionState {
  mode: string;
  cwd?: string;
}

export interface LayerEntry {
  layer: ModeLayer;
  source: ModeSource;
}

export type ModeGate = (mode: string, owner: unknown) => ModeEnter | undefined;

export interface GateEntry {
  gate: ModeGate;
  layerName?: string;
  key?: string;
}

export interface CoreState {
  sessions: Map<unknown, SessionState>;
  layers: LayerEntry[];
  gates: GateEntry[];
}

const STATE_KEY = Symbol.for("@hollowheap/core/state");

export function getState(): CoreState {
  const store = globalThis as unknown as Record<symbol, CoreState | undefined>;
  const existing = store[STATE_KEY];
  if (existing !== undefined) return existing;
  const created: CoreState = {
    sessions: new Map(),
    layers: [],
    gates: [],
  };
  store[STATE_KEY] = created;
  return created;
}
