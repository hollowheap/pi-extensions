import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
    const coreFiles = readdirSync(`${ROOT}packages/core/src`).filter(
      (name) => name.endsWith(".ts") && !name.includes(".test."),
    );
    const sources = coreFiles.map((name) =>
      readFileSync(`${ROOT}packages/core/src/${name}`, "utf8"),
    );
    expect(sources.some((text) => forbidden.test(text))).toBe(false);
  });
});

describe("S04: export surface, manifest boundary and import subpaths", () => {
  it("S04 C02: core publishes a root export and a wildcard subpath export", () => {
    const core = manifest(`${ROOT}packages/core/package.json`);
    const exports = core.exports as Record<string, string>;
    expect(Object.keys(exports).sort()).toEqual([".", "./*"]);
    expect(exports["."]).toBe("./src/index.ts");
    expect(exports["./*"]).toBe("./src/*.ts");
  });

  it("S04 C03: core's own manifest pulls in no host or schema package", () => {
    const core = manifest(`${ROOT}packages/core/package.json`);
    const forbidden = new RegExp(
      `${["@earendil", "-works"].join("")}|${["type", "box"].join("")}|pi-coding-agent`,
      "i",
    );
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
    ]) {
      const deps = (core[field] as Record<string, string> | undefined) ?? {};
      expect(Object.keys(deps).some((name) => forbidden.test(name))).toBe(
        false,
      );
    }
  });

  it("S04 C04: declaring consumers import core subpaths, never the barrel", () => {
    function sourcesUnder(dir: string): string[] {
      let found: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) found = found.concat(sourcesUnder(path));
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
          found.push(path);
      }
      return found;
    }

    let checked = 0;
    for (const group of ["packages", "extensions"]) {
      for (const entry of readdirSync(`${ROOT}${group}`)) {
        const dir = `${ROOT}${group}/${entry}`;
        if (!existsSync(`${dir}/package.json`)) continue;
        if (!statSync(dir).isDirectory()) continue;
        const pkg = manifest(`${dir}/package.json`);
        const declared = (
          pkg.dependencies as Record<string, string> | undefined
        )?.["@hollowheap/core"];
        if (declared === undefined) continue;
        checked += 1;
        if (!existsSync(`${dir}/src`)) continue;
        for (const file of sourcesUnder(`${dir}/src`)) {
          expect(readFileSync(file, "utf8")).not.toMatch(
            /from\s+["']@hollowheap\/core["']/,
          );
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
