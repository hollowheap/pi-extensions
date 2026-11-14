import { evaluate, getModeLayer, registerMode } from "@hollowheap/core";
import { setMode } from "@hollowheap/core";
import { getSessionSnapshot } from "@hollowheap/core/snapshot";
import { describe, expect, it, vi } from "vitest";
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
      external: "allow",
    });
  });

  it("freezes the exported layer and its defaults", () => {
    expect(Object.isFrozen(AUTOPILOT_MODE)).toBe(true);
    expect(Object.isFrozen(AUTOPILOT_MODE.defaults)).toBe(true);
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

  it("asks for destructive shell commands in autopilot mode and blocks without UI", () => {
    setup();
    const owner = {};
    setMode(owner, "autopilot");

    const destructive = [
      "rm -rf /",
      "rm -rf ~",
      "find / -delete",
      "git push --force origin main",
      "ls; rm -rf /",
    ];

    for (const cmd of destructive) {
      const verdict = evaluate({
        owner,
        cwd: "/work",
        tag: "shell",
        target: cmd,
        rules: [],
      });
      expect(verdict).toBe("ask");

      const resolveVerdict = (
        v: typeof verdict,
        ctx: { hasUI: boolean },
      ): { block: boolean; reason?: string } => {
        if (v === "deny") return { block: true, reason: "denied" };
        if (v === "ask") {
          return ctx.hasUI
            ? { block: false }
            : { block: true, reason: "needs approval (no UI)" };
        }
        return { block: false };
      };

      expect(resolveVerdict(verdict, { hasUI: true })).toEqual({
        block: false,
      });
      expect(resolveVerdict(verdict, { hasUI: false })).toEqual({
        block: true,
        reason: "needs approval (no UI)",
      });
    }

    // Explicit user rule can allow a destructive command
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "shell",
        target: "git push --force origin main",
        rules: [
          {
            tag: "shell",
            pattern: "git push --force origin main",
            effect: "allow",
          },
        ],
      }),
    ).toBe("allow");
  });

  it("publishes session snapshot on lifecycle events", () => {
    const handlers = new Map<string, (event: unknown, ctx?: unknown) => void>();
    const mockPi = {
      on: vi.fn(
        (event: string, handler: (event: unknown, ctx?: unknown) => void) => {
          handlers.set(event, handler);
        },
      ),
    };

    extension(mockPi as never);

    expect(mockPi.on).toHaveBeenCalledWith(
      "session_start",
      expect.any(Function),
    );
    expect(mockPi.on).toHaveBeenCalledWith(
      "session_tree",
      expect.any(Function),
    );
    expect(mockPi.on).toHaveBeenCalledWith("agent_start", expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith("turn_end", expect.any(Function));

    const owner = {};
    const ctx = { sessionManager: owner };

    // Initially mode is default (ask), so active = false
    handlers.get("session_start")?.({}, ctx);
    expect(getSessionSnapshot(owner).autopilot).toEqual(
      expect.objectContaining({ active: false, updatedAt: expect.any(Number) }),
    );

    // Switch mode to autopilot
    setMode(owner, "autopilot");
    handlers.get("turn_end")?.({}, ctx);
    expect(getSessionSnapshot(owner).autopilot).toEqual(
      expect.objectContaining({ active: true, updatedAt: expect.any(Number) }),
    );

    // Switch mode back to ask
    setMode(owner, "ask");
    handlers.get("session_tree")?.({}, ctx);
    expect(getSessionSnapshot(owner).autopilot).toEqual(
      expect.objectContaining({ active: false, updatedAt: expect.any(Number) }),
    );
  });
});
