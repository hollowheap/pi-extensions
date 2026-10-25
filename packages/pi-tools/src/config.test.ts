import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG_FILE_NAME, loadToolsConfig } from "./config.js";

function agentDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-tools-config-"));
}

function write(dir: string, content: string): void {
  writeFileSync(join(dir, CONFIG_FILE_NAME), content);
}

describe("loadToolsConfig", () => {
  it("defaults both tools to direct when the file is missing", () => {
    const dir = agentDir();
    const config = loadToolsConfig(dir);
    expect(config.fd).toBe("direct");
    expect(config.rg).toBe("direct");
    expect(config.path).toBe(join(dir, CONFIG_FILE_NAME));
    expect(config.diagnostics).toEqual([]);
  });

  it("accepts per-tool exposure values", () => {
    const dir = agentDir();
    write(dir, JSON.stringify({ fd: "codemode", rg: "hidden" }));
    const config = loadToolsConfig(dir);
    expect(config.fd).toBe("codemode");
    expect(config.rg).toBe("hidden");
    expect(config.diagnostics).toEqual([]);
  });

  it("defaults missing and invalid values independently", () => {
    const dir = agentDir();
    write(dir, JSON.stringify({ fd: "direct", rg: "sometimes" }));
    const diagnostics: string[] = [];
    const config = loadToolsConfig(dir, (message) => diagnostics.push(message));
    expect(config.fd).toBe("direct");
    expect(config.rg).toBe("direct");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("using direct");
  });

  it("reports invalid JSON and non-object roots", () => {
    const missing = agentDir();
    write(missing, "{");
    expect(loadToolsConfig(missing).diagnostics[0]).toContain(
      "is not valid JSON",
    );

    const array = agentDir();
    write(array, "[]");
    expect(loadToolsConfig(array).diagnostics[0]).toContain(
      "must be an object",
    );
  });
});
