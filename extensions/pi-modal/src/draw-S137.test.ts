import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModalConfig } from "./keymap.js";

describe("S137 border style configuration", () => {
  it("falls back to rounded and diagnoses an unknown borderStyle", () => {
    const dir = mkdtempSync(join(tmpdir(), "s137-modal-"));
    writeFileSync(
      join(dir, "modal.json"),
      JSON.stringify({ borderStyle: "fancy" }),
    );
    const diagnostics: string[] = [];

    const config = loadModalConfig(dir, (message) => diagnostics.push(message));

    expect(config.borderStyle).toBe("rounded");
    expect(diagnostics.some((message) => message.includes("borderStyle"))).toBe(
      true,
    );
  });
});
