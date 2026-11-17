import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { isMemoryActive, loadMemoryConfig } from "./config.js";

describe("S172 opt-in memory observer", () => {
  it("is inactive by default with redaction enabled", () => {
    const config = loadMemoryConfig(mkdtempSync(`${tmpdir()}/s172-memory-`));

    expect(config.enabled).toBe(false);
    expect(config.redactSecrets).toBe(true);
    expect(isMemoryActive(config)).toBe(false);
  });
});
