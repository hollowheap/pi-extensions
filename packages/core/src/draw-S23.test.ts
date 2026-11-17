import { readFileSync, readdirSync } from "node:fs";
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
