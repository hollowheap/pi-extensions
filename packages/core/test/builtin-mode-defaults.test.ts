import { describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import {
  enterMode,
  evaluate,
  getModeLayer,
  registerMode,
  resolveModeName,
} from "../src/modes.js";
import { dropSession, session, setMode } from "../src/state.js";

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

describe("built-in mode matrix and default mode", () => {
  it("exposes manual, edit and plan defaults with manual as the session default", () => {
    expect(resolveModeName("ask")).toBe("manual");
    expect(session({}).mode).toBe("manual");

    expect(getModeLayer("manual")?.defaults).toEqual({
      read: "allow",
      search: "allow",
      edit: "ask",
      shell: "ask",
      external: "allow",
    });
    expect(getModeLayer("edit")?.defaults).toEqual({
      read: "allow",
      search: "allow",
      edit: "allow",
      shell: "ask",
      external: "allow",
    });
    expect(getModeLayer("plan")?.defaults).toEqual({
      read: "allow",
      search: "allow",
      edit: "deny",
      shell: "ask",
      external: "allow",
    });
    dropSession({});
  });
});

describe("name resolution boundary, unknown-mode failure and evaluator consumer", () => {
  it("unknown mode names pass through resolution with no layer", () => {
    expect(resolveModeName("draw-s09-unknown")).toBe("draw-s09-unknown");
    expect(getModeLayer("draw-s09-unknown")).toBeUndefined();
  });

  it("entering an unknown mode reports a diagnostic and changes nothing", () => {
    const owner = {};
    const result = enterMode(owner, "draw-s09-missing");
    expect(result.mode).toBe("manual");
    expect(result.diagnostic).toBe("unknown mode: draw-s09-missing");
    expect(result.notices).toEqual([]);
    expect(session(owner).mode).toBe("manual");
    dropSession(owner);
  });

  it("built-in layer defaults drive evaluation for edit and shell targets", () => {
    const owner = {};
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
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "shell",
        target: "echo hi",
        rules: [],
      }),
    ).toBe("ask");
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
    dropSession(owner);
  });
});
