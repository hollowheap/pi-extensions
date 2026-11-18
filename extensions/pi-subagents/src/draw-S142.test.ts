import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIG_FILE_NAME,
  loadSubagentsConfig,
  saveSubagentsSettings,
} from "./config.js";

describe("S142 generic harness config", () => {
  it("parses a generic CLI harness from subagents.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "s142-subagents-"));
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        harnesses: {
          claude: {
            command: "claude",
            args: ["-p", "{prompt}"],
            input: "arg",
            env: { ANTHROPIC_MODEL: "sonnet" },
          },
        },
      }),
    );

    const config = loadSubagentsConfig(dir);

    expect(config.harnesses.claude).toEqual({
      command: "claude",
      args: ["-p", "{prompt}"],
      input: "arg",
      env: { ANTHROPIC_MODEL: "sonnet" },
    });
    expect(config.diagnostics).toEqual([]);
  });

  it("S142 C02: a missing config file yields empty harnesses and defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "s142-defaults-"));
    const config = loadSubagentsConfig(dir);
    expect(config.harnesses).toEqual({});
    expect(config.diagnostics).toEqual([]);
    expect(config.maxConcurrent).toBe(4);
  });

  it("S142 C03: invalid harness entries are diagnosed and dropped", () => {
    const dir = mkdtempSync(join(tmpdir(), "s142-invalid-"));
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        harnesses: {
          noCommand: { args: [] },
          badInput: { command: "bad", input: "socket" },
          good: { command: "good", input: "arg" },
        },
      }),
    );
    const config = loadSubagentsConfig(dir);
    expect(Object.keys(config.harnesses)).toEqual(["good"]);
    expect(config.diagnostics).toContain(
      'harness "noCommand" needs a command; ignoring',
    );
    expect(config.diagnostics).toContain(
      'harness "badInput" input must be "stdin" or "arg"; ignoring',
    );
  });

  it("S142 C04: saved settings round-trip without losing harnesses", () => {
    const dir = mkdtempSync(join(tmpdir(), "s142-roundtrip-"));
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        harnesses: { claude: { command: "claude", input: "stdin" } },
      }),
    );
    saveSubagentsSettings(dir, { sandboxEnabled: true, sandboxOffline: true });

    const config = loadSubagentsConfig(dir);
    expect(config.harnesses.claude.command).toBe("claude");
    expect(config.sandbox).toMatchObject({ enabled: true, offline: true });
    expect(config.diagnostics).toEqual([]);
  });
});
