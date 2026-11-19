import { SessionCache, getSessionCache } from "@hollowheap/core/session-cache";
import { describe, expect, it, vi } from "vitest";

describe("per-session decide result cache", () => {
  it("expires entries after their TTL and evicts the least-recently-used key", () => {
    vi.useFakeTimers();
    try {
      const cache = new SessionCache<string>(2);
      cache.set("key", "value", 1_000);
      expect(cache.get("key")).toBe("value");
      vi.advanceTimersByTime(1_001);
      expect(cache.get("key")).toBeUndefined();

      cache.set("a", "a");
      cache.set("b", "b");
      expect(cache.get("a")).toBe("a");
      cache.set("c", "c");
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("a")).toBe("a");
      expect(cache.get("c")).toBe("c");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps a non-finite capacity to a single LRU entry", () => {
    const cache = new SessionCache<string>(Number.NaN);
    cache.set("a", "a");
    cache.set("b", "b");
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("b");
  });

  it("a zero TTL expires lazily and frees only the stale entry", () => {
    vi.useFakeTimers();
    try {
      const cache = new SessionCache<string>(3);
      cache.set("stale", "x", 0);
      cache.set("fresh", "y", 1_000);
      expect(cache.get("stale")).toBeUndefined();
      expect(cache.size).toBe(1);
      expect(cache.get("fresh")).toBe("y");
    } finally {
      vi.useRealTimers();
    }
  });

  it("getSessionCache scopes instances by owner and namespace", () => {
    const owner = {};
    const first = getSessionCache<string>(owner, "results", { maxEntries: 2 });
    const again = getSessionCache<string>(owner, "results", { maxEntries: 9 });
    const otherNamespace = getSessionCache<string>(owner, "inflight", {
      maxEntries: 2,
    });
    const otherOwner = getSessionCache<string>({}, "results", {
      maxEntries: 2,
    });
    expect(again).toBe(first);
    expect(otherNamespace).not.toBe(first);
    expect(otherOwner).not.toBe(first);
  });
});
