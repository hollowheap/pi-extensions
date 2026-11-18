import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pkgRoot = fileURLToPath(new URL("../", import.meta.url));

describe("S52: pi-todos is a workspace extension with a core dependency", () => {
  it("is listed in the root suite and depends on core", () => {
    const root = JSON.parse(readFileSync(`${repoRoot}package.json`, "utf8"));
    const pkg = JSON.parse(readFileSync(`${pkgRoot}package.json`, "utf8"));
    expect(root.pi.extensions).toContain("./extensions/pi-todos/index.ts");
    expect(pkg.dependencies["@hollowheap/core"]).toBe("^0.3.0");
    expect(pkg.pi.extensions).toContain("./index.ts");
  });
});

describe("entry point, manifest identity, and docs seams", () => {
  it("S52 C02: the extension entry re-exports the source module", () => {
    const entry = readFileSync(`${pkgRoot}index.ts`, "utf8");
    expect(entry).toContain('"./src/index.js"');
  });

  it("S52 C03: the manifest declares a single pi extension entry and packaged files", () => {
    const pkg = JSON.parse(readFileSync(`${pkgRoot}package.json`, "utf8"));
    expect(pkg.name).toBe("@hollowheap/pi-todos");
    expect(pkg.pi.extensions).toEqual(["./index.ts"]);
    expect(pkg.files).toEqual(
      expect.arrayContaining(["index.ts", "src", "README.md"]),
    );
  });

  it("S52 C04: the README documents the codemode flow and branch state", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    expect(readme).toContain("tools.todo");
    expect(readme).toContain("hollowheap.todos");
    expect(readme).toContain("/todos");
    expect(readme).toContain("priority");
  });
});
