import { describe, expect, it } from "vitest";
import {
  MAX_REDIRECTS,
  assertSafeResolvedUrl,
  isSafeUrl,
  isUnsafeHost,
} from "./url.js";

describe("S82: only public http(s) URLs are accepted on every hop", () => {
  it("rejects private, credentialed, and non-http targets", async () => {
    expect(isSafeUrl("https://example.com/x")).toBe(true);
    expect(MAX_REDIRECTS).toBe(5);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeUrl("https://user:pass@example.com")).toBe(false);
    for (const host of ["127.0.0.1", "localhost", "10.0.0.1", "169.254.169.254", "[::1]"]) {
      expect(isSafeUrl(`http://${host}`)).toBe(false);
    }
    expect(isUnsafeHost("010.0.0.1")).toBe(true);
    await expect(
      assertSafeResolvedUrl("https://example.com", async () => [{ address: "127.0.0.1", family: 4 }]),
    ).rejects.toThrow(/not allowed/);
  });
});
