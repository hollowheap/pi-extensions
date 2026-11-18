import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_SERVERS,
  CONFIG_FILE_NAME,
  findServer,
  loadLanguageToolsConfig,
  missingCommandHint,
  noServerHint,
} from "./config.js";

describe("S65: user language-tools.json overlays built-ins and drops malformed entries", () => {
  it("overlays a built-in server and finds it for the configured suffix", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-lang-tools-draw-"));
    const path = join(dir, CONFIG_FILE_NAME);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        servers: {
          mine: {
            command: "my-ls",
            args: ["--stdio"],
            extensions: { ".mine": "mine" },
            timeoutMs: 2_000,
          },
          typescript: {
            command: "my-ts-ls",
            args: ["--stdio"],
            extensions: { ".ts": "typescript" },
          },
        },
      }),
    );
    const time = new Date(1_000);
    utimesSync(path, time, time);

    const config = loadLanguageToolsConfig(dir);
    expect(config.diagnostics).toEqual([]);
    expect(config.servers[0]).toMatchObject({
      name: "mine",
      source: "config",
      timeoutMs: 2_000,
    });
    expect(config.servers.filter((s) => s.name === "typescript")).toHaveLength(
      1,
    );
    expect(findServer(config, "file.ts")?.server.command).toBe("my-ts-ls");
    expect(findServer(config, "file.mine")?.languageId).toBe("mine");
  });

  it("S65 C02: drops malformed server entries and reports each reason", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-lang-tools-draw-"));
    const path = join(dir, CONFIG_FILE_NAME);
    const diagnostics: string[] = [];
    writeFileSync(
      path,
      JSON.stringify({
        servers: {
          badCommand: { command: "", extensions: { ".bad": "bad" } },
          badExtensions: { command: "ls", extensions: { ts: "x" } },
          good: { command: "good-ls", extensions: { ".good": "good" } },
        },
      }),
    );
    const config = loadLanguageToolsConfig(dir, (m) => diagnostics.push(m));
    const joined = diagnostics.join(" ");
    expect(joined).toContain("non-empty string");
    expect(joined).toContain("suffixes like");
    expect(config.servers.some((s) => s.name === "good")).toBe(true);
    expect(config.servers.some((s) => s.name === "badCommand")).toBe(false);
    expect(config.servers.some((s) => s.name === "badExtensions")).toBe(false);
    expect(findServer(config, "file.good")?.languageId).toBe("good");
  });

  it("S65 C03: falls back to built-in servers without a config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-lang-tools-draw-"));
    const config = loadLanguageToolsConfig(dir);
    expect(config.diagnostics).toEqual([]);
    expect(config.servers).toEqual(BUILTIN_SERVERS);
    expect(findServer(config, "file.py")?.server.name).toBe("python");
    expect(findServer(config, "file.zzz")).toBeUndefined();
  });

  it("S65 C04: produces setup hints for missing commands and unmapped suffixes", () => {
    const configPath = "/agent/language-tools.json";
    const server = {
      name: "fake",
      command: "fake-ls",
      args: [],
      extensions: { ".x": "x" },
      timeoutMs: 1000,
      source: "config" as const,
    };
    const missing = missingCommandHint(server, configPath);
    expect(missing).toContain("fake-ls");
    expect(missing).toContain("servers.fake");
    expect(missing).toContain(configPath);
    const noServer = noServerHint("file.zzz", configPath);
    expect(noServer).toContain(".zzz");
    expect(noServer).toContain(configPath);
  });
});
