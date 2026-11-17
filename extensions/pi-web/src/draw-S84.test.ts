import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pkgRoot = fileURLToPath(new URL("../", import.meta.url));

describe("S84: web provider docs cover keys, shapes, and caps", () => {
  it("documents env keys in the package README and pi-web in root docs", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    const rootReadme = readFileSync(`${repoRoot}README.md`, "utf8");
    expect(readme).toContain("TAVILY_API_KEY");
    expect(readme).toContain("EXA_API_KEY");
    expect(readme).toContain("FIRECRAWL_API_KEY");
    expect(readme).toContain("rendering");
    expect(rootReadme).toContain("pi-web");
  });
});
