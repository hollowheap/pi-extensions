import { afterEach, describe, expect, it, vi } from "vitest";
import { getSessionCache } from "./session-cache.js";
import { dropSession } from "./state.js";

const owners: object[] = [];

afterEach(() => {
  for (const owner of owners.splice(0)) dropSession(owner);
});

describe("S138 session cache isolation", () => {
  it("keeps entries from separate session owners apart", () => {
    const first = {};
    const second = {};
    owners.push(first, second);

    const firstCache = getSessionCache<string>(first, "results", {
      maxEntries: 8,
    });
    const secondCache = getSessionCache<string>(second, "results", {
      maxEntries: 8,
    });
    firstCache.set("key", "value");

    expect(firstCache.get("key")).toBe("value");
    expect(secondCache.get("key")).toBeUndefined();
  });

  it("S138 C02: the least-recently-used entry is evicted at the size limit", () => {
    const owner = {};
    owners.push(owner);
    const cache = getSessionCache<string>(owner, "lru", { maxEntries: 2 });
    cache.set("a", "first");
    cache.set("b", "second");
    expect(cache.get("a")).toBe("first");
    cache.set("c", "third");

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("first");
    expect(cache.get("c")).toBe("third");
    expect(cache.size).toBe(2);
  });

  it("S138 C03: expired entries are dropped on read", () => {
    vi.useFakeTimers();
    try {
      const owner = {};
      owners.push(owner);
      const cache = getSessionCache<string>(owner, "ttl", { maxEntries: 4 });
      cache.set("key", "stale", 1_000);
      vi.advanceTimersByTime(1_001);
      expect(cache.get("key")).toBeUndefined();
      expect(cache.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("S138 C04: dropping a session clears that owner's cache", () => {
    const owner = {};
    const cache = getSessionCache<string>(owner, "teardown", {
      maxEntries: 4,
    });
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");

    dropSession(owner);
    expect(
      getSessionCache<string>(owner, "teardown", { maxEntries: 4 }).get("key"),
    ).toBeUndefined();
  });
});
