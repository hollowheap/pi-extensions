import { describe, expect, it } from "vitest";
import { MAX_REDIRECTS, assertSafeUrl, isSafeUrl } from "./url.js";

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
