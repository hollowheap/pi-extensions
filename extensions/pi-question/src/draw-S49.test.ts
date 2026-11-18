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

describe("entry, docs, and manifest seams", () => {
  it("S49 C02: the extension entry re-exports the source module", () => {
    const entry = readFileSync(`${pkgRoot}index.ts`, "utf8");
    expect(entry).toContain('"./src/index.js"');
  });

  it("S49 C03: the README documents both dialog paths and cancellation", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    expect(readme).toContain("TUI:");
    expect(readme).toContain("RPC:");
    expect(readme).toContain("Cancellation:");
    expect(readme).toContain("condition");
  });

  it("S49 C04: the manifest declares the pi entry and host peer dependencies", () => {
    const pkg = JSON.parse(readFileSync(`${pkgRoot}package.json`, "utf8"));
    expect(pkg.pi.extensions).toEqual(["./index.ts"]);
    expect(Object.keys(pkg.peerDependencies)).toEqual(
      expect.arrayContaining([
        "@earendil-works/pi-coding-agent",
        "@earendil-works/pi-tui",
        "typebox",
      ]),
    );
  });
});
