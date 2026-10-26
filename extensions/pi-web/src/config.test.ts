import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG_FILE_NAME, loadWebConfig } from "./config.js";

function agentDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-web-config-"));
}

function write(dir: string, content: string): void {
  writeFileSync(join(dir, CONFIG_FILE_NAME), content);
}

describe("loadWebConfig", () => {
  it("returns defaults when the file is missing", () => {
    const dir = agentDir();
    const config = loadWebConfig(dir);
    expect(config.searchOrder).toBeUndefined();
    expect(config.fetchOrder).toBeUndefined();
    expect(config.path).toBe(join(dir, CONFIG_FILE_NAME));
    expect(config.diagnostics).toEqual([]);
  });

  it("loads valid search and fetch order arrays", () => {
    const dir = agentDir();
    write(
      dir,
      JSON.stringify({
        search: { order: ["tavily", "exa"] },
        fetch: { order: ["raw", "tavily"] },
      }),
    );
    const config = loadWebConfig(dir);
    expect(config.searchOrder).toEqual(["tavily", "exa"]);
    expect(config.fetchOrder).toEqual(["raw", "tavily"]);
    expect(config.diagnostics).toEqual([]);
  });

  it("diagnoses unknown providers and fetch-incompatible entries", () => {
    const dir = agentDir();
    write(
      dir,
      JSON.stringify({
        search: { order: ["exa", "unknown", "exa"] },
        fetch: { order: ["tavily", "firecrawl", "unknown"] },
      }),
    );
    const config = loadWebConfig(dir);
    expect(config.searchOrder).toEqual(["exa"]);
    expect(config.fetchOrder).toEqual(["tavily"]);
    expect(config.diagnostics).toHaveLength(3);
  });

  it("ignores keys fields without leaking values", () => {
    const dir = agentDir();
    write(
      dir,
      JSON.stringify({
        keys: { TAVILY_API_KEY: "secret-value" },
        search: { keys: { EXA_API_KEY: "secret-value" }, order: ["exa"] },
        fetch: { keys: { TAVILY_API_KEY: "secret-value" }, order: ["tavily"] },
      }),
    );
    const diagnostics: string[] = [];
    const config = loadWebConfig(dir, (message) => diagnostics.push(message));
    expect(config.searchOrder).toEqual(["exa"]);
    expect(config.fetchOrder).toEqual(["tavily"]);
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.join(" ")).not.toContain("secret-value");
  });

  it("reports invalid JSON and non-object roots", () => {
    const json = agentDir();
    write(json, "{");
    expect(loadWebConfig(json).diagnostics[0]).toContain("is not valid JSON");

    const array = agentDir();
    write(array, "[]");
    expect(loadWebConfig(array).diagnostics[0]).toContain("must be an object");
  });

  it("reports non-array order values", () => {
    const dir = agentDir();
    write(
      dir,
      JSON.stringify({
        search: { order: "exa" },
        fetch: { order: 1 },
      }),
    );
    const config = loadWebConfig(dir);
    expect(config.searchOrder).toBeUndefined();
    expect(config.fetchOrder).toBeUndefined();
    expect(config.diagnostics).toHaveLength(2);
  });
});
