import { describe, expect, it } from "vitest";
import { getMtimeCache } from "./mtime-cache.js";

let sequence = 0;

function namespace(): string {
  sequence += 1;
  return `test-${sequence}`;
}

describe("mtime cache", () => {
  it("returns values only while the signature matches", () => {
    const cache = getMtimeCache<string>(namespace(), { maxEntries: 2 });

    cache.set("key", "v1", "first");
    expect(cache.get("key", "v1")).toBe("first");
    expect(cache.get("key", "v2")).toBeUndefined();
    expect(cache.get("key", "v1")).toBeUndefined();
  });

  it("evicts the least-recently-used entry", () => {
    const cache = getMtimeCache<string>(namespace(), { maxEntries: 2 });

    cache.set("a", "1", "A");
    cache.set("b", "1", "B");
    expect(cache.get("a", "1")).toBe("A");
    cache.set("c", "1", "C");

    expect(cache.get("b", "1")).toBeUndefined();
    expect(cache.get("a", "1")).toBe("A");
    expect(cache.get("c", "1")).toBe("C");
  });

  it("isolates namespaces", () => {
    const first = getMtimeCache<string>(namespace(), { maxEntries: 2 });
    const second = getMtimeCache<string>(namespace(), { maxEntries: 2 });

    first.set("key", "1", "first");
    expect(second.get("key", "1")).toBeUndefined();
  });

  it("clears and deletes entries", () => {
    const cache = getMtimeCache<string>(namespace(), { maxEntries: 2 });
    cache.set("a", "1", "A");
    cache.set("b", "1", "B");

    expect(cache.delete("a")).toBe(true);
    expect(cache.get("a", "1")).toBeUndefined();
    cache.clear();
    expect(cache.get("b", "1")).toBeUndefined();
  });
});
