import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pkgRoot = fileURLToPath(new URL("../", import.meta.url));

describe("S63: pi-language-tools is a workspace extension exposing lang", () => {
  it("is listed in the root suite, depends on core, and declares the lang tool", () => {
    const root = JSON.parse(readFileSync(`${repoRoot}package.json`, "utf8"));
    const pkg = JSON.parse(readFileSync(`${pkgRoot}package.json`, "utf8"));
    const source = readFileSync(`${pkgRoot}src/tool.ts`, "utf8");
    expect(root.pi.extensions).toContain(
      "./extensions/pi-language-tools/index.ts",
    );
    expect(pkg.dependencies["@hollowheap/core"]).toBe("^0.3.0");
    expect(pkg.dependencies.typebox).toBeUndefined();
    expect(source).toContain('name: "lang"');
  });
});
