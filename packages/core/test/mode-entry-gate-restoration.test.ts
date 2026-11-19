import { describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import { registerMode, registerModeGate, resetSession } from "../src/modes.js";
import { dropSession, session } from "../src/state.js";
import type { Effect, Tag } from "../src/types.js";

const ALLOW: Record<Tag, Effect> = {
  read: "allow",
  search: "allow",
  edit: "allow",
  shell: "allow",
  external: "allow",
};

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

describe("restoring a mode re-runs entry gates and veto falls back to the default", () => {
  it("returns the gate veto/notice and restores the default mode on a veto", () => {
    registerMode({
      name: "restore-gated",
      defaults: ALLOW,
      onEnter: () => ({
        veto: "no budget",
        notice: { text: "needs approval", level: "warning" },
      }),
    });
    const stop = registerModeGate((mode) =>
      mode === "restore-gated"
        ? { notice: { text: "gate ran", level: "info" } }
        : undefined,
    );
    const entries = [
      { customType: "hollowheap.core.mode", data: { mode: "restore-gated" } },
    ];
    const owner = { getEntries: () => entries };

    const result = resetSession(owner);
    expect(result.veto).toBe("no budget");
    expect(result.notices.map((notice) => notice.text)).toEqual(
      expect.arrayContaining(["gate ran", "needs approval"]),
    );
    expect(result.notices).toHaveLength(2);
    expect(result.mode).toBe("manual");
    expect(session(owner).mode).toBe("manual");

    stop();
    dropSession(owner);
  });
});

describe("no-persisted boundary, retired mode and gate-driven restore", () => {
  it("restoring with no persisted mode stays manual and skips gates", () => {
    const calls: string[] = [];
    const stop = registerModeGate(() => {
      calls.push("gate");
      return undefined;
    });
    const owner = {};
    const result = resetSession(owner);
    expect(result.mode).toBe("manual");
    expect(result.notices).toEqual([]);
    expect(calls).toEqual([]);
    expect(session(owner).mode).toBe("manual");
    stop();
    dropSession(owner);
  });

  it("a persisted mode that no longer exists falls back with a diagnostic", () => {
    const entries = [
      {
        customType: "hollowheap.core.mode",
        data: { mode: "draw-s27-retired" },
      },
    ];
    const owner = { getEntries: () => entries };
    const result = resetSession(owner);
    expect(result.mode).toBe("manual");
    expect(result.diagnostic).toContain("no longer exists");
    expect(session(owner).mode).toBe("manual");
    dropSession(owner);
  });

  it("a registered gate veto restores the default mode on reset", () => {
    registerMode({ name: "draw-s27-gated", defaults: ALLOW });
    const stop = registerModeGate((mode) =>
      mode === "draw-s27-gated"
        ? {
            veto: "gate says no",
            notice: { text: "gate notice", level: "warning" },
          }
        : undefined,
    );
    const entries = [
      { customType: "hollowheap.core.mode", data: { mode: "draw-s27-gated" } },
    ];
    const owner = { getEntries: () => entries };
    const result = resetSession(owner);
    expect(result.mode).toBe("manual");
    expect(result.veto).toBe("gate says no");
    expect(result.notices.map((notice) => notice.text)).toContain(
      "gate notice",
    );
    expect(session(owner).mode).toBe("manual");
    stop();
    dropSession(owner);
  });
});
