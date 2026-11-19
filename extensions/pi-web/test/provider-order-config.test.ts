import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIG_FILE_NAME,
  loadWebConfig,
  saveWebSettings,
} from "../src/settings.js";

describe("web.json holds only order arrays and never returns keys", () => {
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

  it("diagnoses non-array orders and non-object roots", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-web-draw-"));
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        search: { order: "exa" },
        fetch: { order: ["raw", 5] },
      }),
    );
    const diagnostics: string[] = [];
    const config = loadWebConfig(dir, (m) => diagnostics.push(m));
    expect(diagnostics.join(" ")).toContain("must be an array");
    expect(diagnostics.join(" ")).toContain("unknown provider");
    expect(config.searchOrder).toBeUndefined();
    expect(config.fetchOrder).toEqual(["raw"]);

    const other = mkdtempSync(join(tmpdir(), "pi-web-draw-"));
    writeFileSync(join(other, CONFIG_FILE_NAME), JSON.stringify([1, 2]));
    const rootDiagnostics: string[] = [];
    loadWebConfig(other, (m) => rootDiagnostics.push(m));
    expect(rootDiagnostics.join(" ")).toContain("must be an object");
  });

  it("uses defaults silently when the config file is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-web-draw-"));
    const diagnostics: string[] = [];
    const config = loadWebConfig(dir, (m) => diagnostics.push(m));
    expect(diagnostics).toEqual([]);
    expect(config.searchOrder).toBeUndefined();
    expect(config.fetchOrder).toBeUndefined();
    expect(config.path).toContain(CONFIG_FILE_NAME);
  });

  it("saves order arrays while preserving unrelated fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-web-draw-"));
    const path = join(dir, CONFIG_FILE_NAME);
    writeFileSync(
      path,
      JSON.stringify({
        custom: "keep",
        search: { order: ["tavily"] },
        fetch: { order: ["exa"] },
      }),
    );
    saveWebSettings(dir, { searchOrder: ["exa"], fetchOrder: ["raw"] });
    const config = loadWebConfig(dir);
    expect(config.searchOrder).toEqual(["exa"]);
    expect(config.fetchOrder).toEqual(["raw"]);
    expect(JSON.parse(readFileSync(path, "utf8")).custom).toBe("keep");
  });
});
