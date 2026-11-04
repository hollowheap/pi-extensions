import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIG_FILE_NAME,
  LEGACY_CONFIG_FILE_NAME,
  loadDecideConfig,
} from "./config.js";

function agentDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-decide-config-"));
}

function write(dir: string, content: string): void {
  writeFileSync(join(dir, CONFIG_FILE_NAME), content);
}

describe("loadDecideConfig", () => {
  it("returns defaults when the file is missing", () => {
    const dir = agentDir();
    const config = loadDecideConfig(dir);
    expect(config.model).toBeUndefined();
    expect(config.timeoutMs).toBe(5000);
    expect(config.maxInputChars).toBe(20000);
    expect(config.cacheTtlMs).toBe(600000);
    expect(config.path).toBe(join(dir, CONFIG_FILE_NAME));
    expect(config.diagnostics).toEqual([]);
  });

  it("reads the legacy classifier.json with a deprecation warning", () => {
    const dir = agentDir();
    writeFileSync(
      join(dir, LEGACY_CONFIG_FILE_NAME),
      JSON.stringify({ model: "typesafe/jev-latest" }),
    );
    const diagnostics: string[] = [];
    const config = loadDecideConfig(dir, (message) =>
      diagnostics.push(message),
    );

    expect(config.model).toBe("typesafe/jev-latest");
    expect(config.path).toBe(join(dir, LEGACY_CONFIG_FILE_NAME));
    expect(diagnostics[0]).toContain("deprecated");
    expect(diagnostics[0]).toContain(CONFIG_FILE_NAME);
  });

  it("reports non-missing read failures", () => {
    const dir = agentDir();
    mkdirSync(join(dir, CONFIG_FILE_NAME));
    const diagnostics: string[] = [];

    const config = loadDecideConfig(dir, (message) =>
      diagnostics.push(message),
    );

    expect(config.model).toBeUndefined();
    expect(config.diagnostics).toHaveLength(1);
    expect(config.diagnostics[0]).toContain(CONFIG_FILE_NAME);
    expect(diagnostics).toEqual(config.diagnostics);
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
    const config = loadDecideConfig(dir);
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
    const config = loadDecideConfig(dir, (message) =>
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
    expect(loadDecideConfig(json).diagnostics[0]).toContain(
      "is not valid JSON",
    );

    const array = agentDir();
    write(array, "[]");
    expect(loadDecideConfig(array).diagnostics[0]).toContain(
      "must be an object",
    );
  });
});
