import { type SessionState, getState } from "./registry.js";
import { dropSessionSnapshot, updateSessionSnapshot } from "./snapshot.js";

export type { SessionState } from "./registry.js";

const MODE_ENTRY = "hollowheap.core.mode";
export const CWD_ENTRY = "hollowheap.core.cwd";
const DEFAULT_MODE = "manual";

export interface EntryLike {
  customType?: unknown;
  data?: unknown;
}

export interface SessionLike {
  getEntries?: () => readonly EntryLike[];
  getBranch?: () => readonly EntryLike[];
  appendCustomEntry?: (customType: string, data?: unknown) => unknown;
  appendEntry?: (customType: string, data?: unknown) => unknown;
}

export function session(owner: unknown): SessionState {
  const state = getState().sessions.get(owner);
  return state === undefined ? { mode: DEFAULT_MODE } : { ...state };
}

export function appendCustomEntry(
  owner: unknown,
  customType: string,
  data: unknown,
): boolean {
  const sessionObj = owner as SessionLike | undefined;
  const appendCustomFn = sessionObj?.appendCustomEntry;
  const appendFn = sessionObj?.appendEntry;
  try {
    if (typeof appendCustomFn === "function") {
      appendCustomFn.call(owner, customType, data);
      return true;
    }
    if (typeof appendFn === "function") {
      appendFn.call(owner, customType, data);
      return true;
    }
  } catch {
    // A session that cannot persist still keeps the in-process state.
  }
  return false;
}

export function appendSessionEntry(
  pi:
    | { appendEntry?: (customType: string, data?: unknown) => unknown }
    | undefined,
  owner: unknown,
  customType: string,
  data: unknown,
): boolean {
  const appendFn = pi?.appendEntry;
  if (typeof appendFn === "function") {
    try {
      appendFn.call(pi, customType, data);
      return true;
    } catch {
      return false;
    }
  }
  return appendCustomEntry(owner, customType, data);
}

export function readBranchEntries(
  owner: unknown,
): readonly EntryLike[] | undefined {
  const sessionObj = owner as SessionLike | undefined;
  const getBranch = sessionObj?.getBranch;
  const getEntries = sessionObj?.getEntries;
  try {
    if (typeof getBranch === "function") {
      return getBranch.call(owner);
    }
    if (typeof getEntries === "function") {
      return getEntries.call(owner);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function readLastCustomEntry(
  owner: unknown,
  customType: string,
): unknown {
  const entries = readBranchEntries(owner);
  if (entries === undefined) return undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as
      | (EntryLike & { type?: unknown })
      | undefined;
    if (entry?.customType === customType || entry?.type === customType) {
      return entry.data;
    }
  }
  return undefined;
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
  updateSessionSnapshot(owner, "mode", { name: mode, updatedAt: Date.now() });
  if (options.persist === false) return;
  appendCustomEntry(owner, MODE_ENTRY, { mode });
}

export function setCwd(
  owner: unknown,
  dir: string | undefined,
  options: { persist?: boolean } = {},
): void {
  const state = getState();
  const current = state.sessions.get(owner) ?? { mode: DEFAULT_MODE };
  if (dir === undefined) {
    if (current.mode === DEFAULT_MODE) state.sessions.delete(owner);
    else state.sessions.set(owner, { mode: current.mode });
    updateSessionSnapshot(owner, "cwd", undefined);
  } else {
    state.sessions.set(owner, { ...current, cwd: dir });
    updateSessionSnapshot(owner, "cwd", {
      effective: dir,
      updatedAt: Date.now(),
    });
  }
  if (options.persist === true) {
    appendCustomEntry(owner, CWD_ENTRY, {
      cwd: dir ?? null,
      updatedAt: Date.now(),
    });
  }
}

export function effectiveCwd(cwd: string, owner: unknown): string {
  return getState().sessions.get(owner)?.cwd ?? cwd;
}

export function dropSession(owner: unknown): void {
  const state = getState();
  state.sessions.delete(owner);
  if (typeof owner === "object" && owner !== null) {
    state.caches.delete(owner);
  }
  dropSessionSnapshot(owner);
}

export function readPersistedMode(owner: unknown): string | undefined {
  const entries = readBranchEntries(owner);
  if (entries === undefined) return undefined;
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

export function readPersistedCwd(owner: unknown): string | null | undefined {
  const entries = readBranchEntries(owner);
  if (entries === undefined) return undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.customType !== CWD_ENTRY) continue;
    const data = entry.data;
    if (typeof data !== "object" || data === null) continue;
    const cwd = (data as { cwd?: unknown }).cwd;
    if (cwd === null) return null;
    if (typeof cwd === "string" && cwd !== "") return cwd;
  }
  return undefined;
}

export interface DirtyFlusher {
  markDirty(): void;
  flush(write: () => void): void;
}

export function createDirtyFlusher(): DirtyFlusher {
  let dirty = false;
  return {
    markDirty() {
      dirty = true;
    },
    flush(write) {
      if (!dirty) return;
      write();
      dirty = false;
    },
  };
}
