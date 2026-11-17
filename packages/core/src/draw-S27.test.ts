import { describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import { registerMode, registerModeGate, resetSession } from "./modes.js";
import { dropSession, session } from "./state.js";
import type { Effect, Tag } from "./types.js";

const ALLOW: Record<Tag, Effect> = {
  read: "allow",
  search: "allow",
  edit: "allow",
  shell: "allow",
  external: "allow",
};

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

describe("S27: restoring a mode re-runs entry gates and veto falls back to the default", () => {
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
