import { describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import { getModeLayer, registerMode, resolveModeName } from "./modes.js";
import { dropSession, session } from "./state.js";

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

describe("S09: built-in mode matrix and default mode", () => {
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
