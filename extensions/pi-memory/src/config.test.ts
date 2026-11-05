import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MEMORY_CONFIG_FILE,
  isMemoryActive,
  loadMemoryConfig,
} from "./config.js";

function agentDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-memory-config-"));
}

function write(dir: string, value: unknown): void {
  writeFileSync(
    join(dir, MEMORY_CONFIG_FILE),
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

describe("loadMemoryConfig", () => {
  it("returns disabled defaults when the file is missing", () => {
    const config = loadMemoryConfig(agentDir());
    expect(config).toMatchObject({
      enabled: false,
      model: "",
      observeAfterTokens: 20_000,
      maxObservations: 50,
      injectionTokens: 2_000,
      redactSecrets: true,
      notifyErrors: false,
    });
    expect(config.diagnostics).toEqual([]);
    expect(isMemoryActive(config)).toBe(false);
  });

  it("accepts a valid config", () => {
    const dir = agentDir();
    write(dir, {
      enabled: true,
      model: "provider/model-id",
      observeAfterTokens: 40_000,
      maxObservations: 25,
      injectionTokens: 4_000,
      redactSecrets: false,
      notifyErrors: true,
    });
    const config = loadMemoryConfig(dir);
    expect(isMemoryActive(config)).toBe(true);
    expect(config).toMatchObject({
      enabled: true,
      model: "provider/model-id",
      observeAfterTokens: 40_000,
      maxObservations: 25,
      injectionTokens: 4_000,
      redactSecrets: false,
      notifyErrors: true,
    });
    expect(config.diagnostics).toEqual([]);
  });

  it("defaults invalid values with diagnostics", () => {
    const dir = agentDir();
    write(dir, {
      enabled: "yes",
      model: "model-only",
      observeAfterTokens: 1,
      maxObservations: 0,
      injectionTokens: 10,
      redactSecrets: "yes",
      notifyErrors: 1,
    });
    const config = loadMemoryConfig(dir);
    expect(config).toMatchObject({
      enabled: false,
      model: "",
      observeAfterTokens: 20_000,
      maxObservations: 50,
      injectionTokens: 2_000,
      redactSecrets: true,
      notifyErrors: false,
    });
    expect(config.diagnostics).toHaveLength(7);
  });

  it("rejects incomplete provider/model pairs", () => {
    const dir = agentDir();
    write(dir, { enabled: true, model: "provider/" });
    const config = loadMemoryConfig(dir);
    expect(config.model).toBe("");
    expect(isMemoryActive(config)).toBe(false);
    expect(config.diagnostics.join(" ")).toContain("provider/model-id");
  });

  it("marks enabled without a model as inactive", () => {
    const dir = agentDir();
    write(dir, { enabled: true });
    const config = loadMemoryConfig(dir);
    expect(isMemoryActive(config)).toBe(false);
    expect(config.diagnostics.join(" ")).toContain("model");
  });

  it("defaults malformed JSON and non-object roots", () => {
    const json = agentDir();
    write(json, "{");
    expect(loadMemoryConfig(json).diagnostics[0]).toContain(
      "pi-memory-config-",
    );

    const array = agentDir();
    write(array, []);
    expect(loadMemoryConfig(array).diagnostics[0]).toContain(
      "must be an object",
    );
  });
});
