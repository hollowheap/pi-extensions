import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

  it("S183 C02: a missing config file is created with the mutation", () => {
    const path = join(
      mkdtempSync(join(tmpdir(), "s183-new-")),
      "nested",
      "settings.json",
    );

    const result = updateJsonConfig(path, (current) => {
      current.added = true;
    });

    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      added: true,
    });
  });

  it("S183 C03: a valid JSON array is rejected as a non-object config", () => {
    const path = join(
      mkdtempSync(join(tmpdir(), "s183-array-")),
      "settings.json",
    );
    const raw = "[1, 2, 3]";
    writeFileSync(path, raw);

    const result = updateJsonConfig(path, (current) => {
      current.mutated = true;
    });

    expect(result.ok).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(raw);
  });

  it("S183 C04: a successful write keeps other fields and leaves no temp file", () => {
    const dir = mkdtempSync(join(tmpdir(), "s183-keep-"));
    const path = join(dir, "settings.json");
    writeFileSync(path, JSON.stringify({ keep: "yes", change: "old" }));

    const result = updateJsonConfig(path, (current) => {
      current.change = "new";
    });

    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      keep: "yes",
      change: "new",
    });
    expect(readdirSync(dir).some((name) => name.endsWith(".tmp"))).toBe(false);
  });
});
