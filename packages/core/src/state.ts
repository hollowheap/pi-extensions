import { type SessionState, getState } from "./registry.js";

export type { SessionState } from "./registry.js";

const MODE_ENTRY = "hollowheap.core.mode";
const DEFAULT_MODE = "ask";

interface EntryLike {
  customType?: unknown;
  data?: unknown;
}

export interface SessionLike {
  getEntries?: () => readonly EntryLike[];
  appendCustomEntry?: (customType: string, data?: unknown) => unknown;
}

export function session(owner: unknown): SessionState {
  const state = getState().sessions.get(owner);
  return state === undefined ? { mode: DEFAULT_MODE } : { ...state };
}

export function setMode(
  owner: unknown,
  mode: string,
  options: { persist?: boolean } = {},
): void {
  const state = getState();
  const current = state.sessions.get(owner) ?? { mode: DEFAULT_MODE };
  if (current.mode === mode) return;
  state.sessions.set(owner, { ...current, mode });
  if (options.persist === false) return;
  const append = (owner as SessionLike | undefined)?.appendCustomEntry;
  if (typeof append !== "function") return;
  try {
    append.call(owner, MODE_ENTRY, { mode });
  } catch {
    // A session that cannot persist still keeps the in-process mode.
  }
}

export function setCwd(owner: unknown, dir: string | undefined): void {
  const state = getState();
  const current = state.sessions.get(owner) ?? { mode: DEFAULT_MODE };
  if (dir === undefined) {
    if (current.mode === DEFAULT_MODE) state.sessions.delete(owner);
    else state.sessions.set(owner, { mode: current.mode });
    return;
  }
  state.sessions.set(owner, { ...current, cwd: dir });
}

export function effectiveCwd(cwd: string, owner: unknown): string {
  return getState().sessions.get(owner)?.cwd ?? cwd;
}

export function dropSession(owner: unknown): void {
  getState().sessions.delete(owner);
}

export function readPersistedMode(owner: unknown): string | undefined {
  const getEntries = (owner as SessionLike | undefined)?.getEntries;
  if (typeof getEntries !== "function") return undefined;
  let entries: readonly EntryLike[];
  try {
    entries = getEntries.call(owner);
  } catch {
    return undefined;
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.customType !== MODE_ENTRY) continue;
    const data = entry.data;
    if (typeof data !== "object" || data === null) continue;
    const mode = (data as { mode?: unknown }).mode;
    if (typeof mode === "string" && mode !== "") return mode;
  }
  return undefined;
}
