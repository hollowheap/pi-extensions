import { describe, expect, it, vi } from "vitest";
import { dropSession, session, setCwd, setMode } from "./state.js";

describe("S03: state singleton on globalThis", () => {
  it("keeps one registry across independent module loads", async () => {
    const owner = {};
    setMode(owner, "plan");
    setCwd(owner, "/work/sub");

    const store = globalThis as unknown as Record<symbol, unknown>;
    const registry = store[Symbol.for("@hollowheap/core/state")] as {
      sessions: Map<unknown, unknown>;
    };
    expect(registry.sessions instanceof Map).toBe(true);

    vi.resetModules();
    const fresh = await import("./state.js");
    expect(fresh.session(owner)).toEqual({ mode: "plan", cwd: "/work/sub" });
    fresh.dropSession(owner);
    expect(session(owner)).toEqual({ mode: "manual" });
    dropSession(owner);
  });
});
