import { describe, expect, it } from "vitest";
import { REDACTED, redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
  it("redacts common token formats", () => {
    const text = [
      "sk-abcdefghijklmnopqrstuvwxyz123456",
      "ghp_abcdefghijklmnopqrstuvwxyz123456",
      "npm_abcdefghijklmnopqrstuvwxyz123456",
      "AKIAABCDEFGHIJKLMNOP",
      "Bearer abcdefghijklmnopqrstuvwxyz",
      "Basic dXNlcjpwYXNzd29yZA==",
    ].join(" ");
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain("sk-");
    expect(redacted).not.toContain("ghp_");
    expect(redacted).not.toContain("npm_");
    expect(redacted).not.toContain("AKIA");
    expect(redacted).not.toContain("Bearer");
    expect(redacted).not.toContain("Basic");
    expect(redacted.match(/\[REDACTED\]/g)).toHaveLength(6);
  });

  it("redacts private keys and key-value secrets", () => {
    const text = [
      "-----BEGIN PRIVATE KEY-----",
      "secret-material",
      "-----END PRIVATE KEY-----",
      "password: hunter2hunter2",
      'client_secret = "abcdefghijk"',
    ].join("\n");
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain("secret-material");
    expect(redacted).not.toContain("hunter2hunter2");
    expect(redacted).not.toContain("abcdefghijk");
    expect(redacted).toContain(REDACTED);
  });

  it("redacts secret-bearing URL parameters", () => {
    const text = "https://example.test/path?token=abcdefghijk&x=1";
    expect(redactSecrets(text)).toBe(
      "https://example.test/path?token=[REDACTED]&x=1",
    );
  });

  it("leaves ordinary text unchanged", () => {
    const text = "The build uses npm and the test suite is green.";
    expect(redactSecrets(text)).toBe(text);
  });
});
