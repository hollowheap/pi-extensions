import { describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import { registerMode, resetSession } from "./modes.js";
import {
  dropSession,
  effectiveCwd,
  session,
  setCwd,
  setMode,
} from "./state.js";

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

describe("S02: session state seam", () => {
  it("reads mode and cwd through session and effectiveCwd without host events", () => {
    const entries: { customType: string; data?: unknown }[] = [];
    const owner = {
      getEntries: () => entries,
      appendCustomEntry: (customType: string, data?: unknown) => {
        entries.push({ customType, data });
        return "entry";
      },
    };

    expect(session(owner)).toEqual({ mode: "manual" });
    expect(effectiveCwd("/work", owner)).toBe("/work");

    setMode(owner, "plan");
    setCwd(owner, "/work/sub");
    expect(session(owner)).toEqual({ mode: "plan", cwd: "/work/sub" });
    expect(effectiveCwd("/work", owner)).toBe("/work/sub");

    expect(resetSession(owner).mode).toBe("plan");

    dropSession(owner);
    expect(session(owner)).toEqual({ mode: "manual" });
    expect(effectiveCwd("/work", owner)).toBe("/work");
  });
});
