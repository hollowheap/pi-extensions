import { describe, expect, it, vi } from "vitest";
import { getState } from "../src/registry.js";
import { dropSession, session, setCwd, setMode } from "../src/state.js";

interface SharedRegistry {
  sessions: Map<unknown, unknown>;
  caches: WeakMap<object, unknown>;
  layers: unknown[];
  gates: unknown[];
}

function registry(): SharedRegistry {
  const store = globalThis as unknown as Record<symbol, unknown>;
  return store[Symbol.for("@hollowheap/core/state")] as SharedRegistry;
}

describe("state singleton on globalThis", () => {
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
    const fresh = await import("../src/state.js");
    expect(fresh.session(owner)).toEqual({ mode: "plan", cwd: "/work/sub" });
    fresh.dropSession(owner);
    expect(session(owner)).toEqual({ mode: "manual" });
    dropSession(owner);
  });
});

describe("shared registry shape, persistence failure and owner isolation", () => {
  it("the global registry exposes the documented shared collections", () => {
    getState();
    const shared = registry();
    expect(shared.sessions).toBeInstanceOf(Map);
    expect(shared.caches).toBeInstanceOf(WeakMap);
    expect(Array.isArray(shared.layers)).toBe(true);
    expect(Array.isArray(shared.gates)).toBe(true);
  });

  it("an owner whose persistence throws still keeps state across module loads", async () => {
    const owner = {
      appendCustomEntry: () => {
        throw new Error("read only");
      },
    };
    setMode(owner, "plan");
    vi.resetModules();
    const fresh = await import("../src/state.js");
    expect(fresh.session(owner)).toEqual({ mode: "plan" });
    fresh.dropSession(owner);
    dropSession(owner);
  });

  it("independent owners keep isolated state in the shared registry", async () => {
    const first = {};
    const second = {};
    setMode(first, "plan");
    setCwd(first, "/work/sub");
    setMode(second, "edit");

    vi.resetModules();
    const fresh = await import("../src/state.js");
    expect(fresh.session(first)).toEqual({ mode: "plan", cwd: "/work/sub" });
    expect(fresh.session(second)).toEqual({ mode: "edit" });
    fresh.dropSession(first);
    fresh.dropSession(second);
    dropSession(first);
    dropSession(second);
  });
});
