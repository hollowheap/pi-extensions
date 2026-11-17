import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function manifest(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("S04: core dependency and import boundary", () => {
  it("declares a single core version in consumers and keeps core host-free", () => {
    const groups: string[] = [];
    for (const group of ["packages", "extensions"]) {
      for (const entry of readdirSync(`${ROOT}${group}`)) {
        groups.push(`${ROOT}${group}/${entry}/package.json`);
      }
    }
    const versions = groups
      .map((path) => {
        try {
          return manifest(path);
        } catch {
          return undefined;
        }
      })
      .map((pkg) =>
        pkg === undefined
          ? undefined
          : (pkg.dependencies as Record<string, string> | undefined)?.[
              "@hollowheap/core"
            ],
      )
      .filter((version): version is string => version !== undefined);

    expect(versions.length).toBeGreaterThan(0);
    expect(new Set(versions)).toEqual(new Set(["^0.3.0"]));

    const forbidden = new RegExp(
      `${["@earendil", "-works"].join("")}|${["type", "box"].join("")}`,
    );
    const coreFiles = readdirSync(`${ROOT}packages/core/src`).filter((name) =>
      name.endsWith(".ts"),
    );
    const sources = coreFiles.map((name) =>
      readFileSync(`${ROOT}packages/core/src/${name}`, "utf8"),
    );
    expect(sources.some((text) => forbidden.test(text))).toBe(false);
  });
});
