import { describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import { registerMode, resetSession } from "./modes.js";
import { dropSession, readPersistedMode, session, setMode } from "./state.js";

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

interface Entry {
  customType?: unknown;
  data?: unknown;
}

function ownerWith(entries: Entry[]) {
  return {
    getEntries: () => entries,
    appendCustomEntry: (customType: string, data?: unknown) => {
      entries.push({ customType, data });
      return "entry";
    },
  };
}

describe("S24: mode changes persist and survive resume and fork", () => {
  it("appends hollowheap.core.mode, reads it back, and keeps it on resume/fork", () => {
    const entries: Entry[] = [];
    const owner = ownerWith(entries);
    setMode(owner, "plan");
    expect(entries).toEqual([
      { customType: "hollowheap.core.mode", data: { mode: "plan" } },
    ]);
    expect(readPersistedMode(owner)).toBe("plan");

    const persisted = [
      { customType: "hollowheap.core.mode", data: { mode: "plan" } },
    ];
    const resumed = ownerWith([...persisted]);
    expect(resetSession(resumed).mode).toBe("plan");
    expect(session(resumed).mode).toBe("plan");
    dropSession(resumed);

    const forked = ownerWith([...persisted]);
    expect(resetSession(forked).mode).toBe("plan");
    dropSession(forked);
    dropSession(owner);
  });
});
