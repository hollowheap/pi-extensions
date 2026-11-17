import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pkgRoot = fileURLToPath(new URL("../", import.meta.url));

describe("S68: pi-tasks is a workspace extension with core and runtime deps", () => {
  it("is listed in the root suite without a typebox dependency", () => {
    const root = JSON.parse(readFileSync(`${repoRoot}package.json`, "utf8"));
    const pkg = JSON.parse(readFileSync(`${pkgRoot}package.json`, "utf8"));
    expect(root.pi.extensions).toContain("./extensions/pi-tasks/index.ts");
    expect(pkg.dependencies["@hollowheap/core"]).toBe("^0.3.0");
    expect(pkg.dependencies["@hollowheap/runtime"]).toBe("^0.3.0");
    expect(pkg.dependencies.typebox).toBeUndefined();
  });
});
