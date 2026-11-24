import type { Theme } from "@earendil-works/pi-coding-agent";

const SHARED_HEADER = Symbol.for("@hollowheap/ui/shared-header");

interface SharedHeaderState {
  renderer: SharedHeaderRenderer | undefined;
}

export interface SharedHeaderRenderer {
  render(width: number, theme?: Partial<Theme>): readonly string[];
}

function state(): SharedHeaderState {
  const store = globalThis as Record<symbol, SharedHeaderState | undefined>;
  const existing = store[SHARED_HEADER];
  if (existing !== undefined) return existing;
  const created: SharedHeaderState = { renderer: undefined };
  store[SHARED_HEADER] = created;
  return created;
}

/** Publish the current dashboard header renderer for other UI surfaces to reuse. */
export function registerSharedHeader(
  renderer: SharedHeaderRenderer,
): () => void {
  const current = state();
  current.renderer = renderer;
  return () => {
    if (current.renderer === renderer) current.renderer = undefined;
  };
}

/** Current dashboard header renderer, when a dashboard is installed. */
export function getSharedHeader(): SharedHeaderRenderer | undefined {
  return state().renderer;
}
