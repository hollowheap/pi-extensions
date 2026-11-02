import { afterEach, describe, expect, it, vi } from "vitest";
import { getSessionCache } from "./session-cache.js";
import { dropSession } from "./state.js";

const owners: object[] = [];

function owner(): object {
  const created = {};
  owners.push(created);
  return created;
}

afterEach(() => {
  for (const entry of owners.splice(0)) dropSession(entry);
  vi.useRealTimers();
});

describe("session cache", () => {
  it("isolates caches by owner and namespace", () => {
    const first = owner();
    const second = owner();
    const firstCache = getSessionCache<string>(first, "results", {
      maxEntries: 10,
    });
    const secondCache = getSessionCache<string>(second, "results", {
      maxEntries: 10,
    });
    const otherNamespace = getSessionCache<string>(first, "other", {
      maxEntries: 10,
    });

    firstCache.set("key", "value");

    expect(firstCache.get("key")).toBe("value");
    expect(secondCache.get("key")).toBeUndefined();
    expect(otherNamespace.get("key")).toBeUndefined();
  });

  it("evicts the least-recently-used entry", () => {
    const cache = getSessionCache<string>(owner(), "lru", { maxEntries: 2 });

    cache.set("a", "A");
    cache.set("b", "B");
    expect(cache.get("a")).toBe("A");
    cache.set("c", "C");

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("A");
    expect(cache.get("c")).toBe("C");
  });

  it("expires entries after their TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const cache = getSessionCache<string>(owner(), "ttl", { maxEntries: 2 });

    cache.set("short", "value", 100);
    vi.setSystemTime(1_099);
    expect(cache.get("short")).toBe("value");
    vi.setSystemTime(1_100);
    expect(cache.get("short")).toBeUndefined();
  });

  it("clears caches when a session is dropped", () => {
    const session = owner();
    const cache = getSessionCache<string>(session, "results", {
      maxEntries: 10,
    });
    cache.set("key", "value");

    dropSession(session);

    const next = getSessionCache<string>(session, "results", {
      maxEntries: 10,
    });
    expect(next.get("key")).toBeUndefined();
  });
});
