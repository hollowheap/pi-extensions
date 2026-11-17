import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = fileURLToPath(new URL("../", import.meta.url));

describe("S49: pi-question manifest and docs describe the tool-based flow", () => {
  it("declares the core dependency and documents the codemode tool", () => {
    const pkg = JSON.parse(readFileSync(`${pkgRoot}package.json`, "utf8"));
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    expect(pkg.dependencies["@hollowheap/core"]).toBe("^0.3.0");
    expect(readme).toContain("codemode");
    expect(readme).toContain("question");
    expect(readme).toContain("Tagged question blocks are no longer used");
  });
});
