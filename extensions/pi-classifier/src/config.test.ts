import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG_FILE_NAME, loadClassifierConfig } from "./config.js";

function agentDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-classifier-config-"));
}

function write(dir: string, content: string): void {
  writeFileSync(join(dir, CONFIG_FILE_NAME), content);
}

describe("loadClassifierConfig", () => {
  it("returns defaults when the file is missing", () => {
    const dir = agentDir();
    const config = loadClassifierConfig(dir);
    expect(config.model).toBeUndefined();
    expect(config.timeoutMs).toBe(5000);
    expect(config.maxInputChars).toBe(20000);
    expect(config.cacheTtlMs).toBe(600000);
    expect(config.path).toBe(join(dir, CONFIG_FILE_NAME));
    expect(config.diagnostics).toEqual([]);
  });

  it("accepts a valid config", () => {
    const dir = agentDir();
    write(
      dir,
      JSON.stringify({
        model: "typesafe/jev-latest",
        timeoutMs: 2000,
        maxInputChars: 1000,
        cacheTtlMs: 0,
      }),
    );
    const config = loadClassifierConfig(dir);
    expect(config.model).toBe("typesafe/jev-latest");
    expect(config.timeoutMs).toBe(2000);
    expect(config.maxInputChars).toBe(1000);
    expect(config.cacheTtlMs).toBe(0);
    expect(config.diagnostics).toEqual([]);
  });

  it("defaults invalid values with diagnostics", () => {
    const dir = agentDir();
    const diagnostics: string[] = [];
    write(
      dir,
      JSON.stringify({
        model: "bad",
        timeoutMs: 0,
        maxInputChars: 0,
        cacheTtlMs: -1,
      }),
    );
    const config = loadClassifierConfig(dir, (message) =>
      diagnostics.push(message),
    );
    expect(config.model).toBeUndefined();
    expect(config.timeoutMs).toBe(5000);
    expect(config.maxInputChars).toBe(20000);
    expect(config.cacheTtlMs).toBe(600000);
    expect(diagnostics).toHaveLength(4);
  });

  it("reports invalid JSON and non-object roots", () => {
    const json = agentDir();
    write(json, "{");
    expect(loadClassifierConfig(json).diagnostics[0]).toContain(
      "is not valid JSON",
    );

    const array = agentDir();
    write(array, "[]");
    expect(loadClassifierConfig(array).diagnostics[0]).toContain(
      "must be an object",
    );
  });
});
