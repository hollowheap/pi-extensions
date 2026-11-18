import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function manifest(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("S23: core and consumer version alignment", () => {
  it("publishes one core version and pins every consumer to the matching range", () => {
    const coreVersion = manifest(`${ROOT}packages/core/package.json`).version;
    expect(coreVersion).toBe("0.3.0");

    const ranges: string[] = [];
    for (const group of ["packages", "extensions"]) {
      for (const entry of readdirSync(`${ROOT}${group}`)) {
        const path = `${ROOT}${group}/${entry}/package.json`;
        let pkg: Record<string, unknown>;
        try {
          pkg = manifest(path);
        } catch {
          continue;
        }
        const range = (
          pkg.dependencies as Record<string, string> | undefined
        )?.["@hollowheap/core"];
        if (range !== undefined) ranges.push(range);
      }
    }
    expect(ranges.length).toBeGreaterThan(0);
    expect(new Set(ranges)).toEqual(new Set([`^${coreVersion}`]));
  });
});

describe("S23: range form, deprecated pins and subpath resolution", () => {
  function consumerRanges(): string[] {
    const ranges: string[] = [];
    for (const group of ["packages", "extensions"]) {
      for (const entry of readdirSync(`${ROOT}${group}`)) {
        let pkg: Record<string, unknown>;
        try {
          pkg = manifest(`${ROOT}${group}/${entry}/package.json`);
        } catch {
          continue;
        }
        const range = (
          pkg.dependencies as Record<string, string> | undefined
        )?.["@hollowheap/core"];
        if (range !== undefined) ranges.push(range);
      }
    }
    return ranges;
  }

  it("S23 C02: every consumer core range uses the caret prefix", () => {
    const ranges = consumerRanges();
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges.every((range) => range.startsWith("^"))).toBe(true);
  });

  it("S23 C03: no consumer pins a deprecated core version", () => {
    const ranges = consumerRanges();
    expect(ranges.length).toBeGreaterThan(0);
    for (const range of ranges) {
      expect(range.includes("0.1.0")).toBe(false);
      expect(range.includes("0.2.0")).toBe(false);
    }
  });

  it("S23 C04: core subpaths imported by a consumer resolve to real source files", () => {
    const source = readFileSync(
      `${ROOT}extensions/pi-guard/src/index.ts`,
      "utf8",
    );
    const subpaths = new Set<string>();
    for (const match of source.matchAll(
      /from\s+["']@hollowheap\/core\/([a-z-]+)["']/g,
    )) {
      subpaths.add(match[1]);
    }
    expect(subpaths.size).toBeGreaterThan(0);
    for (const subpath of subpaths) {
      expect(existsSync(`${ROOT}packages/core/src/${subpath}.ts`)).toBe(true);
    }
  });
});
