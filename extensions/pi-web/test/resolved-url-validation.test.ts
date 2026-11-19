import { describe, expect, it, vi } from "vitest";
import { assertSafeResolvedUrl } from "../src/url.js";

describe("resolved URL safety", () => {
  it("rejects a hostname whose DNS answer is a private address", async () => {
    const resolver = async () => [{ address: "127.0.0.1", family: 4 }];

    await expect(
      assertSafeResolvedUrl("https://localtest.me", resolver),
    ).rejects.toThrow(/not allowed/);
  });

  it("a resolver failure is reported as an unresolved target", async () => {
    const resolver = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });

    await expect(
      assertSafeResolvedUrl("https://example.com", resolver),
    ).rejects.toThrow(/could not be resolved/);
    expect(resolver).toHaveBeenCalledWith("example.com");
  });

  it("a hostname with no DNS answers is rejected", async () => {
    const resolver = async () => [];

    await expect(
      assertSafeResolvedUrl("https://example.com", resolver),
    ).rejects.toThrow(/not allowed/);
  });

  it("a public IP literal is accepted without consulting DNS", async () => {
    const resolver = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
    ]);

    await expect(
      assertSafeResolvedUrl("https://93.184.216.34", resolver),
    ).resolves.toBeUndefined();
    expect(resolver).not.toHaveBeenCalled();
  });
});
