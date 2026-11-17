import { afterEach, describe, expect, it } from "vitest";
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
});
