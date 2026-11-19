import { describe, expect, it } from "vitest";
import {
  evaluate,
  getModeLayer,
  modeLayers,
  registerMode,
} from "../src/modes.js";
import { dropSession, setMode } from "../src/state.js";
import type { ModeLayer } from "../src/types.js";

describe("ModeLayer is the public registration shape", () => {
  it("accepts name, defaults, overrides and onEnter without an apply detail", () => {
    const onEnter = () => ({ notice: { text: "hi", level: "info" as const } });
    const layer: ModeLayer = {
      name: "draw-s07-layer",
      defaults: { read: "allow", edit: "ask" },
      overrides: [{ tag: "edit", pattern: "src/*", effect: "deny" }],
      onEnter,
    };
    expect(registerMode(layer)).toBe(true);

    const registered = getModeLayer("draw-s07-layer");
    expect(registered).toMatchObject({
      name: "draw-s07-layer",
      defaults: { read: "allow", edit: "ask" },
      overrides: [{ tag: "edit", pattern: "src/*", effect: "deny" }],
    });
    expect(registered?.onEnter).toBe(onEnter);
    expect(modeLayers()).toContainEqual(registered);
    expect(Object.keys(registered ?? {})).not.toContain("apply");
    expect(Object.keys(registered ?? {})).not.toContain("inPlanPaths");
  });
});

describe("minimal layer shape, duplicate rejection and evaluator consumer", () => {
  it("a layer registered without optional fields keeps only name and defaults", () => {
    const layer: ModeLayer = {
      name: "draw-s07-minimal",
      defaults: { edit: "ask" },
    };
    expect(registerMode(layer)).toBe(true);
    const registered = getModeLayer("draw-s07-minimal");
    expect(Object.keys(registered ?? {}).sort()).toEqual(["defaults", "name"]);
    expect(registered?.overrides).toBeUndefined();
    expect(registered?.onEnter).toBeUndefined();
  });

  it("a duplicate registration is rejected without replacing the first layer", () => {
    const name = "draw-s07-duplicate";
    expect(registerMode({ name, defaults: { edit: "allow" } })).toBe(true);
    const diagnostics: string[] = [];
    expect(
      registerMode({ name, defaults: { edit: "deny" } }, (message) =>
        diagnostics.push(message),
      ),
    ).toBe(false);
    expect(diagnostics[0]).toContain("already registered");
    expect(getModeLayer(name)?.defaults.edit).toBe("allow");
  });

  it("a registered layer's defaults decide evaluation with no rules", () => {
    registerMode({
      name: "draw-s07-consumer",
      defaults: {
        read: "allow",
        search: "allow",
        edit: "deny",
        shell: "deny",
        external: "allow",
      },
    });
    const owner = {};
    setMode(owner, "draw-s07-consumer");
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
        tag: "read",
        target: "src/a.ts",
        rules: [],
      }),
    ).toBe("allow");
    dropSession(owner);
  });
});
