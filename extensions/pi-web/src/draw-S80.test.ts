import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG_FILE_NAME, loadWebConfig } from "./config.js";

describe("S80: web.json holds only order arrays and never returns keys", () => {
  it("loads valid orders, diagnoses unknown names, and ignores keys fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-web-draw-"));
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        keys: { TAVILY_API_KEY: "secret-value" },
        search: {
          keys: { EXA_API_KEY: "secret-value" },
          order: ["exa", "unknown"],
        },
        fetch: { order: ["raw", "tavily"] },
      }),
    );
    const diagnostics: string[] = [];
    const config = loadWebConfig(dir, (message) => diagnostics.push(message));
    expect(config.searchOrder).toEqual(["exa"]);
    expect(config.fetchOrder).toEqual(["raw", "tavily"]);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.join(" ")).not.toContain("secret-value");
  });
});
