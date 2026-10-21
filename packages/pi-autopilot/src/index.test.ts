import type { ModesQuery } from "@hollowheap/core";
import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

function setup() {
  const listeners: ((data: unknown) => void)[] = [];
  const pi = {
    events: {
      on: vi.fn((channel: string, fn: (data: unknown) => void) => {
        if (channel === "guard:modes") listeners.push(fn);
        return () => {};
      }),
      emit: vi.fn(),
    },
  };
  extension(pi as never);
  return { listeners };
}

describe("pi-autopilot extension", () => {
  it("subscribes to the guard modes query", () => {
    const { listeners } = setup();
    expect(listeners).toHaveLength(1);
  });

  it("appends the autopilot descriptor once", () => {
    const { listeners } = setup();
    const query: ModesQuery = { modes: [{ name: "ask", apply: (_t, v) => v }] };
    listeners[0](query);
    listeners[0](query);
    expect(query.modes.map((entry) => entry.name)).toEqual([
      "ask",
      "autopilot",
    ]);
  });

  it("runs everything but deny", () => {
    const { listeners } = setup();
    const query: ModesQuery = { modes: [] };
    listeners[0](query);
    const apply = query.modes[0].apply;
    const details = { inPlanPaths: false };
    expect(apply("edit", "allow", details)).toBe("allow");
    expect(apply("edit", "ask", details)).toBe("allow");
    expect(apply("shell", "allow", details)).toBe("allow");
    expect(apply("shell", "ask", details)).toBe("allow");
    expect(apply("read", "ask", details)).toBe("allow");
    expect(apply("read", "deny", details)).toBe("deny");
  });

  it("warns on entry", () => {
    const { listeners } = setup();
    const query: ModesQuery = { modes: [] };
    listeners[0](query);
    expect(query.modes[0].onEnter?.({})).toEqual({
      notice: {
        text: "autopilot on: writes and non-dangerous bash run without asking",
        level: "warning",
      },
    });
  });
});
