import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSubagentsConfig } from "./config.js";

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
});
