import { SessionCache } from "@hollowheap/core/session-cache";
import { describe, expect, it, vi } from "vitest";

describe("S91 per-session decide result cache", () => {
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
});
