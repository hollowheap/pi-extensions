import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FETCH_DEFAULT_CHARS,
  FETCH_MAX_CHARS,
  FETCH_MAX_LINKS,
  FETCH_MAX_MEDIA,
  SEARCH_DEFAULT_RESULTS,
  SEARCH_MAX_RESULTS,
} from "./tools.js";

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

  it("S84 C02: documents the provider capability matrix", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    expect(readme).toContain("| Exa | yes | yes (Contents) |");
    expect(readme).toContain("| Tavily | yes | yes (Extract) |");
    expect(readme).toContain("| Firecrawl | yes | no |");
    expect(readme).toContain("| raw HTTP | no | yes |");
  });

  it("S84 C03: documents caps, safety limits, and timeout", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    expect(readme).toContain("Links cap at 50");
    expect(readme).toContain("media caps at 20");
    expect(readme).toContain("15 seconds");
    expect(readme).toContain("capped at 5");
    expect(readme).toContain("5 MB");
  });

  it("S84 C04: documents output fields and cap constants", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    expect([SEARCH_DEFAULT_RESULTS, SEARCH_MAX_RESULTS]).toEqual([5, 10]);
    expect([FETCH_MAX_LINKS, FETCH_MAX_MEDIA]).toEqual([50, 20]);
    expect([FETCH_DEFAULT_CHARS, FETCH_MAX_CHARS]).toEqual([20_000, 100_000]);
    expect(readme).toContain("default 5, capped at 10");
    expect(readme).toContain("default 20,000, capped at 100,000");
    expect(readme).toContain("{ results, truncated }");
  });
});
