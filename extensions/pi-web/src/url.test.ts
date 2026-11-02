import { describe, expect, it } from "vitest";
import {
  MAX_REDIRECTS,
  assertSafeResolvedUrl,
  assertSafeUrl,
  isSafeUrl,
  isUnsafeHost,
} from "./url.js";

describe("URL safety", () => {
  it("allows public http(s) URLs", () => {
    expect(isSafeUrl("https://example.com/x")).toBe(true);
    expect(() => assertSafeUrl("http://example.com")).not.toThrow();
    expect(MAX_REDIRECTS).toBe(5);
  });

  it("rejects non-http schemes", () => {
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    expect(() => assertSafeUrl("ftp://example.com")).toThrow();
  });

  it("rejects credentials", () => {
    expect(isSafeUrl("https://user:pass@example.com")).toBe(false);
  });

  it("rejects hostnames that resolve to private addresses", async () => {
    const privateResolver = async () => [{ address: "127.0.0.1", family: 4 }];
    await expect(
      assertSafeResolvedUrl("https://localtest.me", privateResolver),
    ).rejects.toThrow(/not allowed/);
    const mixedResolver = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ];
    await expect(
      assertSafeResolvedUrl("https://example.com", mixedResolver),
    ).rejects.toThrow(/not allowed/);
  });

  it("allows hostnames that resolve to public addresses", async () => {
    const publicResolver = async () => [
      { address: "93.184.216.34", family: 4 },
    ];
    await expect(
      assertSafeResolvedUrl("https://example.com", publicResolver),
    ).resolves.toBeUndefined();
  });

  it("rejects resolution failures", async () => {
    await expect(
      assertSafeResolvedUrl("https://example.com", async () => {
        throw new Error("dns failed");
      }),
    ).rejects.toThrow(/could not be resolved/);
  });

  it("rejects non-canonical IPv4 forms", () => {
    expect(isUnsafeHost("010.0.0.1")).toBe(true);
    expect(isUnsafeHost("8.08.8.8")).toBe(true);
    expect(isUnsafeHost("8.8.8.8")).toBe(false);
  });

  it("rejects loopback/private/link-local/metadata", () => {
    for (const u of [
      "http://127.0.0.1",
      "http://localhost",
      "http://10.0.0.1",
      "http://192.168.1.1",
      "http://172.16.0.1",
      "http://169.254.169.254",
      "http://0.0.0.0",
      "http://[::1]",
      "http://[fc00::1]",
      "http://[fe80::1]",
      "http://metadata.google.internal",
    ]) {
      expect(isSafeUrl(u)).toBe(false);
    }
  });
});
