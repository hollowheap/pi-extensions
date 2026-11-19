import { describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import {
  enterMode,
  getModeLayer,
  registerMode,
  registerModeGate,
} from "../src/modes.js";
import { dropSession, session } from "../src/state.js";
import type { Effect, Tag } from "../src/types.js";

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

const ALLOW: Record<Tag, Effect> = {
  read: "allow",
  search: "allow",
  edit: "allow",
  shell: "allow",
  external: "allow",
};

describe("first-wins registry and ordered entry gates", () => {
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

describe("keyed gate replacement, gate failure and onEnter composition", () => {
  it("a keyed gate registration replaces the earlier gate with that key", () => {
    const calls: string[] = [];
    const first = registerModeGate(() => {
      calls.push("first");
      return undefined;
    }, "draw-s10-key");
    const second = registerModeGate(() => {
      calls.push("second");
      return undefined;
    }, "draw-s10-key");

    expect(enterMode({}, "manual").notices).toEqual([]);
    expect(calls).toEqual(["second"]);
    first();
    second();
  });

  it("a throwing entry gate propagates to the caller of enterMode", () => {
    const name = "draw-s10-throw-gate";
    registerMode({ name, defaults: ALLOW });
    const stop = registerModeGate((mode) => {
      if (mode !== name) return undefined;
      throw new Error("gate exploded");
    });
    const owner = {};
    expect(() => enterMode(owner, name)).toThrow("gate exploded");
    expect(session(owner).mode).toBe("manual");
    stop();
    dropSession(owner);
  });

  it("a layer's onEnter and a registered gate both run through enterMode", () => {
    const calls: string[] = [];
    const name = "draw-s10-composed";
    registerMode({
      name,
      defaults: ALLOW,
      onEnter: () => {
        calls.push("onEnter");
        return { notice: { text: "entered", level: "info" } };
      },
    });
    const stop = registerModeGate((mode) => {
      if (mode !== name) return undefined;
      calls.push("gate");
      return { notice: { text: "gated", level: "warning" } };
    });
    const owner = {};
    const result = enterMode(owner, name);
    expect(calls).toEqual(["onEnter", "gate"]);
    expect(result.mode).toBe(name);
    expect(result.notices.map((notice) => notice.text)).toEqual([
      "entered",
      "gated",
    ]);
    expect(session(owner).mode).toBe(name);
    stop();
    dropSession(owner);
  });
});
