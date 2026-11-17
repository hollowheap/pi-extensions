import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { updateJsonConfig } from "./config.js";

describe("S183 settings writer refuses invalid config", () => {
  it("leaves an unparseable file byte-identical and reports an error", () => {
    const dir = mkdtempSync(join(tmpdir(), "s183-config-"));
    const path = join(dir, "settings.json");
    const raw = "{ not valid json // keep comment\n";
    writeFileSync(path, raw);

    const result = updateJsonConfig(path, (current) => {
      current.overwritten = true;
    });

    expect(result.ok).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(raw);
  });
});
