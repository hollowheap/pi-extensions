import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadSubagentsConfig,
  resolveSubagentSandboxOptions,
  resolveSubagentWaitTimeoutMs,
} from "./config.js";

describe("S97 subagents.json validation", () => {
  it("applies safe defaults and diagnoses out-of-range limits", () => {
    const dir = mkdtempSync(join(tmpdir(), "s97-cfg-"));
    expect(loadSubagentsConfig(dir)).toMatchObject({
      maxConcurrent: 4,
      maxDepth: 1,
      defaultTimeoutMs: 1_800_000,
      writeLockTimeoutMs: 30_000,
    });

    writeFileSync(
      join(dir, "subagents.json"),
      JSON.stringify({
        maxConcurrent: 99,
        maxDepth: -1,
        defaultTimeoutMs: -1,
      }),
    );
    const diagnostics: string[] = [];
    const config = loadSubagentsConfig(dir, (message) =>
      diagnostics.push(message),
    );
    expect(config).toMatchObject({
      maxConcurrent: 4,
      maxDepth: 1,
      defaultTimeoutMs: 1_800_000,
    });
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("S97 C02: malformed JSON falls back to defaults with a diagnostic", () => {
    const dir = mkdtempSync(join(tmpdir(), "s97-cfg-"));
    writeFileSync(join(dir, "subagents.json"), "{not json");
    const diagnostics: string[] = [];
    const config = loadSubagentsConfig(dir, (message) =>
      diagnostics.push(message),
    );
    expect(config.maxConcurrent).toBe(4);
    expect(config.defaultTimeoutMs).toBe(1_800_000);
    expect(
      diagnostics.some((message) => message.includes("not valid JSON")),
    ).toBe(true);
  });

  it("S97 C03: an invalid sandbox value is diagnosed and ignored", () => {
    const dir = mkdtempSync(join(tmpdir(), "s97-cfg-"));
    writeFileSync(
      join(dir, "subagents.json"),
      JSON.stringify({ sandbox: "yes" }),
    );
    const diagnostics: string[] = [];
    const config = loadSubagentsConfig(dir, (message) =>
      diagnostics.push(message),
    );
    expect(config.sandbox).toBeUndefined();
    expect(diagnostics).toContain(
      '"sandbox" must be a boolean or object; ignoring',
    );
  });

  it("S97 C04: sandbox options resolve per agent and a zero timeout disables the deadline", () => {
    const config = {
      sandbox: true,
      agents: { scout: { sandbox: { enabled: true, offline: true } } },
      defaultTimeoutMs: 0,
    } as never;
    expect(resolveSubagentSandboxOptions(config, "scout")).toEqual({
      offline: true,
    });
    expect(resolveSubagentSandboxOptions(config)).toBe(true);
    expect(resolveSubagentWaitTimeoutMs({ defaultTimeoutMs: 0 })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});
