import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadJsonConfig,
  parseJsonObject,
  readJsonObject,
} from "../src/config.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "json-config-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("parseJsonObject", () => {
  it("returns an object for valid JSON", () => {
    expect(parseJsonObject('{"a":1}', "/config.json", [])).toEqual({ a: 1 });
  });

  it("diagnoses malformed JSON and non-objects", () => {
    const diagnostics: string[] = [];
    expect(parseJsonObject("{", "/config.json", diagnostics)).toBeUndefined();
    expect(parseJsonObject("[]", "/config.json", diagnostics)).toBeUndefined();
    expect(diagnostics).toEqual([
      "/config.json is not valid JSON; using defaults",
      "/config.json must be an object; using defaults",
    ]);
  });

  it("accepts a custom fallback suffix", () => {
    const diagnostics: string[] = [];
    parseJsonObject("{", "/config.json", diagnostics, "; using built-ins");
    expect(diagnostics[0]).toBe(
      "/config.json is not valid JSON; using built-ins",
    );
  });
});

describe("loadJsonConfig", () => {
  it("normalizes a parsed config and exposes diagnostics", () => {
    const dir = tempDir();
    const path = join(dir, "config.json");
    writeFileSync(path, "{bad");
    const diagnostics: string[] = [];

    const result = loadJsonConfig({
      path,
      diagnostics,
      parse: (data, issues) => ({ data, issues: issues.length }),
    });

    expect(result).toEqual({ data: undefined, issues: 1 });
    expect(diagnostics).toHaveLength(1);
  });
});

describe("readJsonObject", () => {
  it("returns undefined without diagnostics for a missing file", () => {
    const diagnostics: string[] = [];
    expect(readJsonObject("/no/such/config.json", diagnostics)).toBeUndefined();
    expect(diagnostics).toEqual([]);
  });

  it("reads and parses an existing file", () => {
    const dir = tempDir();
    const path = join(dir, "config.json");
    writeFileSync(path, '{"enabled":true}');
    expect(readJsonObject(path, [])).toEqual({ enabled: true });
  });

  it("uses custom read and fallback suffixes", () => {
    const diagnostics: string[] = [];
    const path = join(tempDir(), "config.json");
    writeFileSync(path, "{bad");
    expect(
      readJsonObject(path, diagnostics, {
        fallbackSuffix: "; using built-ins",
        readErrorSuffix: "; using defaults",
      }),
    ).toBeUndefined();
    expect(diagnostics[0]).toContain("is not valid JSON; using built-ins");
  });
});
