import { describe, expect, it } from "vitest";
import { assertSafeResolvedUrl } from "./url.js";

describe("S153 resolved URL safety", () => {
  it("rejects a hostname whose DNS answer is a private address", async () => {
    const resolver = async () => [{ address: "127.0.0.1", family: 4 }];

    await expect(
      assertSafeResolvedUrl("https://localtest.me", resolver),
    ).rejects.toThrow(/not allowed/);
  });
});
