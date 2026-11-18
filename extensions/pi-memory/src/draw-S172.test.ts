import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isMemoryActive, loadMemoryConfig } from "./config.js";

describe("S172 opt-in memory observer", () => {
  it("is inactive by default with redaction enabled", () => {
    const config = loadMemoryConfig(mkdtempSync(`${tmpdir()}/s172-memory-`));

    expect(config.enabled).toBe(false);
    expect(config.redactSecrets).toBe(true);
    expect(isMemoryActive(config)).toBe(false);
  });

  it("S172 C02: an enabled config with a valid model becomes active", () => {
    const dir = mkdtempSync(`${tmpdir()}/s172-memory-`);
    writeFileSync(
      join(dir, "memory.json"),
      JSON.stringify({ enabled: true, model: "openai/gpt-5" }),
    );

    const config = loadMemoryConfig(dir);

    expect(config.enabled).toBe(true);
    expect(config.model).toBe("openai/gpt-5");
    expect(config.redactSecrets).toBe(true);
    expect(isMemoryActive(config)).toBe(true);
  });

  it("S172 C03: enabling without a model leaves the observer inactive", () => {
    const dir = mkdtempSync(`${tmpdir()}/s172-memory-`);
    writeFileSync(join(dir, "memory.json"), JSON.stringify({ enabled: true }));
    const diagnostics: string[] = [];

    const config = loadMemoryConfig(dir, (message) =>
      diagnostics.push(message),
    );

    expect(config.enabled).toBe(true);
    expect(config.model).toBe("");
    expect(isMemoryActive(config)).toBe(false);
    expect(diagnostics.join("\n")).toContain('"model" is required');
  });

  it("S172 C04: out-of-range numbers fall back to defaults with diagnostics", () => {
    const dir = mkdtempSync(`${tmpdir()}/s172-memory-`);
    writeFileSync(
      join(dir, "memory.json"),
      JSON.stringify({ observeAfterTokens: 5, injectionTokens: 99_999 }),
    );
    const diagnostics: string[] = [];

    const config = loadMemoryConfig(dir, (message) =>
      diagnostics.push(message),
    );

    expect(config.observeAfterTokens).toBe(20_000);
    expect(config.injectionTokens).toBe(2_000);
    expect(diagnostics.join("\n")).toContain('"observeAfterTokens"');
    expect(diagnostics.join("\n")).toContain('"injectionTokens"');
  });
});
