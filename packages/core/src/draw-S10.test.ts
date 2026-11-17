import { describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import {
  enterMode,
  getModeLayer,
  registerMode,
  registerModeGate,
} from "./modes.js";
import { dropSession, session } from "./state.js";
import type { Effect, Tag } from "./types.js";

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

const ALLOW: Record<Tag, Effect> = {
  read: "allow",
  search: "allow",
  edit: "allow",
  shell: "allow",
  external: "allow",
};

describe("S10: first-wins registry and ordered entry gates", () => {
  it("keeps the first layer and lets the first gate veto block the switch", () => {
    const diagnostics: string[] = [];
    const name = "draw-s10-layer";
    expect(registerMode({ name, defaults: ALLOW })).toBe(true);
    expect(
      registerMode({ name, defaults: { read: "deny" } }, (m) =>
        diagnostics.push(m),
      ),
    ).toBe(false);
    expect(diagnostics[0]).toContain("already registered");
    expect(getModeLayer(name)?.defaults.edit).toBe("allow");

    const calls: string[] = [];
    const stops = [
      registerModeGate((mode) => {
        if (mode !== name) return undefined;
        calls.push("first");
        return { notice: { text: "first", level: "info" as const } };
      }),
      registerModeGate((mode) => {
        if (mode !== name) return undefined;
        calls.push("veto");
        return { veto: "blocked" };
      }),
      registerModeGate((mode) => {
        if (mode !== name) return undefined;
        calls.push("last");
        return { veto: "later" };
      }),
    ];

    const owner = {};
    const result = enterMode(owner, name);
    expect(calls).toEqual(["first", "veto", "last"]);
    expect(result.veto).toBe("blocked");
    expect(result.notices).toEqual([{ text: "first", level: "info" }]);
    expect(session(owner).mode).toBe("manual");

    for (const stop of stops) stop();
    dropSession(owner);
  });
});
