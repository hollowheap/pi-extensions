import { describe, expect, it } from "vitest";
import {
  MAX_REDIRECTS,
  assertSafeResolvedUrl,
  assertSafeUrl,
  isSafeUrl,
  isUnsafeHost,
} from "../src/url.js";

describe("only public http(s) URLs are accepted on every hop", () => {
  it("rejects private, credentialed, and non-http targets", async () => {
    expect(isSafeUrl("https://example.com/x")).toBe(true);
    expect(MAX_REDIRECTS).toBe(5);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeUrl("https://user:pass@example.com")).toBe(false);
    for (const host of [
      "127.0.0.1",
      "localhost",
      "10.0.0.1",
      "169.254.169.254",
      "[::1]",
    ]) {
      expect(isSafeUrl(`http://${host}`)).toBe(false);
    }
    expect(isUnsafeHost("010.0.0.1")).toBe(true);
    await expect(
      assertSafeResolvedUrl("https://example.com", async () => [
        { address: "127.0.0.1", family: 4 },
      ]),
    ).rejects.toThrow(/not allowed/);
  });

  it("reports distinct rejection reasons for unsafe URLs", () => {
    expect(() => assertSafeUrl("not a url")).toThrow("invalid URL");
    expect(() => assertSafeUrl("file:///etc/passwd")).toThrow(
      "must use http or https",
    );
    expect(() => assertSafeUrl("https://user@example.com")).toThrow(
      "must not include credentials",
    );
    expect(() => assertSafeUrl("http://127.0.0.1")).toThrow("not allowed");
    expect(() => assertSafeUrl("https://example.com")).not.toThrow();
  });

  it("rejects unresolved and private DNS answers", async () => {
    await expect(
      assertSafeResolvedUrl("https://example.com", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toThrow("could not be resolved");
    await expect(
      assertSafeResolvedUrl("https://example.com", async () => []),
    ).rejects.toThrow("not allowed");
    await expect(
      assertSafeResolvedUrl("https://example.com", async () => [
        { address: "8.8.8.8", family: 4 },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      assertSafeResolvedUrl("http://127.0.0.1", async () => [
        { address: "8.8.8.8", family: 4 },
      ]),
    ).rejects.toThrow("not allowed");
  });

  it("flags private ranges, metadata hosts, and numeric encodings", () => {
    for (const host of [
      "192.168.1.1",
      "100.64.0.1",
      "172.20.0.1",
      "metadata.google.internal",
      "foo.localhost",
      "0x7f000001",
      "2130706433",
      "fe80::1",
      "fd00::1",
      "::",
    ]) {
      expect(isUnsafeHost(host)).toBe(true);
    }
    expect(isUnsafeHost("example.com")).toBe(false);
  });
});
