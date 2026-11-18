import { describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import { evaluate, registerMode, resetSession } from "./modes.js";
import {
  dropSession,
  effectiveCwd,
  readPersistedMode,
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

describe("S02: session state boundary, persistence failure and policy consumer", () => {
  it("S02 C02: an owner without stored state falls back to manual mode and the supplied cwd", () => {
    const owner = {};
    expect(session(owner)).toEqual({ mode: "manual" });
    expect(effectiveCwd("/base", owner)).toBe("/base");

    setCwd(owner, undefined);
    expect(session(owner)).toEqual({ mode: "manual" });

    setCwd(owner, "/work/sub");
    expect(session(owner)).toEqual({ mode: "manual", cwd: "/work/sub" });
    expect(effectiveCwd("/base", owner)).toBe("/work/sub");

    setCwd(owner, undefined);
    expect(session(owner)).toEqual({ mode: "manual" });
    dropSession(owner);
  });

  it("S02 C03: persistence failures on the owner do not break in-memory state", () => {
    const owner = {
      getEntries: () => {
        throw new Error("no entries");
      },
      appendCustomEntry: () => {
        throw new Error("read only");
      },
    };
    expect(readPersistedMode(owner)).toBeUndefined();
    setMode(owner, "plan");
    expect(session(owner)).toEqual({ mode: "plan" });
    expect(effectiveCwd("/work", owner)).toBe("/work");
    dropSession(owner);
    expect(session(owner)).toEqual({ mode: "manual" });
  });

  it("S02 C04: the stored mode is consumed by policy evaluation", () => {
    const owner = {};
    setMode(owner, "edit");
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "edit",
        target: "src/a.ts",
        rules: [],
      }),
    ).toBe("allow");
    setMode(owner, "plan");
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "edit",
        target: "src/a.ts",
        rules: [],
      }),
    ).toBe("deny");
    dropSession(owner);
  });
});
