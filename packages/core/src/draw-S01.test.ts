import { describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import { checkPath, checkShell, evaluate, loadPermissions } from "./index.js";
import { registerMode } from "./modes.js";
import { dropSession, setMode } from "./state.js";

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

describe("S01: core is the single public policy engine", () => {
  it("exports and applies evaluate, loadPermissions, checkPath and checkShell", () => {
    expect(typeof evaluate).toBe("function");
    expect(typeof loadPermissions).toBe("function");
    expect(typeof checkPath).toBe("function");
    expect(typeof checkShell).toBe("function");

    expect(
      checkPath(
        [{ tag: "edit", pattern: "src/**", effect: "allow" }],
        "src/a.ts",
        "edit",
        "/work",
      ),
    ).toBe("allow");
    expect(checkShell("echo $(date)", []).decision).toBe("deny");

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
    dropSession(owner);
  });
});
