import { evaluate, getModeLayer, registerMode } from "@hollowheap/core";
import { setMode } from "@hollowheap/core";
import { describe, expect, it } from "vitest";
import extension, { AUTOPILOT_MODE } from "./index.js";

function setup(): void {
  extension({} as never);
}

describe("pi-autopilot extension", () => {
  it("registers the autopilot layer with allow defaults", () => {
    setup();
    expect(getModeLayer("autopilot")?.defaults).toEqual({
      read: "allow",
      search: "allow",
      edit: "allow",
      shell: "allow",
    });
  });

  it("keeps the first registration when a layer name repeats", () => {
    setup();
    expect(
      registerMode({
        name: "autopilot",
        defaults: {
          read: "deny",
          search: "deny",
          edit: "deny",
          shell: "deny",
        },
      }),
    ).toBe(false);
    expect(getModeLayer("autopilot")?.defaults.edit).toBe("allow");
  });

  it("allows everything but explicit denies", () => {
    setup();
    const owner = {};
    setMode(owner, "autopilot");
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "edit",
        target: "src/a.ts",
        rules: [],
      }),
    ).toBe("allow");
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "shell",
        target: "git status",
        rules: [],
      }),
    ).toBe("allow");
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "edit",
        target: "src/a.ts",
        rules: [{ tag: "edit", pattern: "src/**", effect: "deny" }],
      }),
    ).toBe("deny");
  });

  it("warns on entry", () => {
    expect(AUTOPILOT_MODE.onEnter?.({})).toEqual({
      notice: {
        text: "autopilot on: writes and non-dangerous bash run without asking",
        level: "warning",
      },
    });
  });
});
