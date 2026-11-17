import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = fileURLToPath(new URL("../", import.meta.url));

describe("S67: pi-language-tools README documents the lang tool and config", () => {
  it("covers actions, positions, config schema, and trust gating", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    expect(readme).toContain("lang");
    expect(readme).toContain("1-based");
    expect(readme).toContain("language-tools.json");
    expect(readme).toContain("trusted");
  });
});
