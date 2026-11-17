import { describe, expect, it } from "vitest";
import { getModeLayer, modeLayers, registerMode } from "./modes.js";
import type { ModeLayer } from "./types.js";

describe("S07: ModeLayer is the public registration shape", () => {
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
