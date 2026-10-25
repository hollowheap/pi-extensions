import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_SERVERS,
  CONFIG_FILE_NAME,
  findServer,
  loadCodeIntelConfig,
  missingCommandHint,
  noServerHint,
} from "./config.js";

function agentDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-code-intel-"));
}

function write(path: string, content: string, seconds: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  const time = new Date(seconds * 1000);
  utimesSync(path, time, time);
}

function load(agentDirPath: string, diagnostics: string[] = []) {
  return loadCodeIntelConfig(agentDirPath, (message) =>
    diagnostics.push(message),
  );
}

describe("built-in servers", () => {
  it("covers the common languages with distinct language ids", () => {
    const config = load(agentDir());
    const typescript = findServer(config, "src/index.ts");
    expect(typescript?.server.name).toBe("typescript");
    expect(typescript?.languageId).toBe("typescript");
    expect(findServer(config, "src/view.tsx")?.languageId).toBe(
      "typescriptreact",
    );
    expect(findServer(config, "src/run.js")?.languageId).toBe("javascript");
    expect(findServer(config, "src/view.jsx")?.languageId).toBe(
      "javascriptreact",
    );
    expect(findServer(config, "tool.py")?.server.name).toBe("python");
    expect(findServer(config, "main.rs")?.server.name).toBe("rust");
    expect(findServer(config, "main.go")?.server.name).toBe("go");
    expect(findServer(config, "main.cpp")?.server.name).toBe("clangd");
    expect(findServer(config, "init.lua")?.server.name).toBe("lua");
    expect(findServer(config, "notes.txt")).toBeUndefined();
  });

  it("exposes the built-in list with defaults", () => {
    expect(BUILTIN_SERVERS.map((server) => server.name)).toEqual([
      "typescript",
      "python",
      "rust",
      "go",
      "clangd",
      "lua",
    ]);
    expect(BUILTIN_SERVERS.every((server) => server.timeoutMs === 10_000)).toBe(
      true,
    );
  });
});

describe("loadCodeIntelConfig", () => {
  it("returns built-ins when the file is missing", () => {
    const dir = agentDir();
    const config = load(dir);
    expect(config.path).toBe(join(dir, CONFIG_FILE_NAME));
    expect(config.servers).toHaveLength(BUILTIN_SERVERS.length);
    expect(config.exposure).toBe("direct");
    expect(config.diagnostics).toEqual([]);
  });

  it("reads the configured exposure", () => {
    const dir = agentDir();
    write(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({ exposure: "codemode" }),
      1_000,
    );
    expect(load(dir).exposure).toBe("codemode");

    write(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({ exposure: "hidden" }),
      1_001,
    );
    expect(load(dir).exposure).toBe("hidden");
  });

  it("defaults invalid exposure to direct", () => {
    const dir = agentDir();
    const diagnostics: string[] = [];
    write(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({ exposure: "always" }),
      1_000,
    );
    const config = load(dir, diagnostics);
    expect(config.exposure).toBe("direct");
    expect(diagnostics[0]).toContain("using direct");
  });

  it("overlays servers by name and adds new servers first", () => {
    const dir = agentDir();
    write(
      join(dir, CONFIG_FILE_NAME),
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
      1_000,
    );

    const config = load(dir);
    expect(config.diagnostics).toEqual([]);
    expect(config.servers[0].name).toBe("mine");
    expect(config.servers[0].source).toBe("config");
    expect(config.servers[0].timeoutMs).toBe(2_000);
    expect(config.servers.filter((s) => s.name === "typescript")).toHaveLength(
      1,
    );
    expect(findServer(config, "file.ts")?.server.command).toBe("my-ts-ls");
    expect(findServer(config, "file.mine")?.languageId).toBe("mine");
  });

  it("matches user servers before built-ins for the same suffix", () => {
    const dir = agentDir();
    write(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        servers: {
          mine: {
            command: "my-ls",
            extensions: { ".ts": "typescript" },
          },
        },
      }),
      1_000,
    );

    const config = load(dir);
    expect(findServer(config, "file.ts")?.server.name).toBe("mine");
    expect(config.servers.at(-1)?.name).toBe("lua");
  });

  it("drops duplicate user suffixes and diagnoses the later server", () => {
    const dir = agentDir();
    const diagnostics: string[] = [];
    write(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        servers: {
          first: {
            command: "first-ls",
            extensions: { ".dup": "first" },
          },
          second: {
            command: "second-ls",
            extensions: { ".dup": "second", ".other": "second" },
          },
        },
      }),
      1_000,
    );

    const config = load(dir, diagnostics);
    expect(findServer(config, "file.dup")?.server.name).toBe("first");
    expect(findServer(config, "file.other")?.server.name).toBe("second");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain(".dup");
  });

  it("drops malformed servers and reports invalid JSON", () => {
    const dir = agentDir();
    const diagnostics: string[] = [];
    write(join(dir, CONFIG_FILE_NAME), "{oops", 1_000);
    expect(load(dir, diagnostics).servers).toHaveLength(BUILTIN_SERVERS.length);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("not valid JSON");

    write(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        servers: {
          "bad-command": { command: "", extensions: { ".a": "a" } },
          "bad-args": {
            command: "x",
            args: "no",
            extensions: { ".b": "b" },
          },
          "bad-extensions": { command: "x", extensions: [] },
          "bad-timeout": {
            command: "x",
            extensions: { ".c": "c" },
            timeoutMs: 0,
          },
          good: { command: "x", extensions: { ".good": "good" } },
        },
      }),
      1_001,
    );

    const config = load(dir);
    expect(config.servers.some((s) => s.name === "good")).toBe(true);
    expect(config.servers.some((s) => s.name === "bad-command")).toBe(false);
    expect(config.servers.some((s) => s.name === "bad-args")).toBe(false);
    expect(config.servers.some((s) => s.name === "bad-extensions")).toBe(false);
    expect(config.servers.some((s) => s.name === "bad-timeout")).toBe(false);
  });

  it("reports diagnostics once per file change", () => {
    const dir = agentDir();
    const path = join(dir, CONFIG_FILE_NAME);
    const diagnostics: string[] = [];

    write(path, "{", 1_000);
    expect(load(dir, diagnostics).servers).toHaveLength(BUILTIN_SERVERS.length);
    expect(load(dir, diagnostics).servers).toHaveLength(BUILTIN_SERVERS.length);
    expect(diagnostics).toHaveLength(1);

    write(path, JSON.stringify({ servers: {} }), 1_001);
    expect(load(dir, diagnostics).servers).toHaveLength(BUILTIN_SERVERS.length);
    expect(diagnostics).toHaveLength(1);

    write(path, "{", 1_002);
    expect(load(dir, diagnostics).servers).toHaveLength(BUILTIN_SERVERS.length);
    expect(diagnostics).toHaveLength(2);
  });

  it("delivers cached diagnostics to a later caller", () => {
    const dir = agentDir();
    write(join(dir, CONFIG_FILE_NAME), "{", 1_000);
    expect(loadCodeIntelConfig(dir).diagnostics).toHaveLength(1);

    const diagnostics: string[] = [];
    expect(load(dir, diagnostics).diagnostics).toHaveLength(1);
    expect(diagnostics).toHaveLength(1);
  });
});

describe("setup hints", () => {
  it("names the missing command and config path", () => {
    const config = load(agentDir());
    const server = config.servers[0];
    const hint = missingCommandHint(server, config.path);
    expect(hint).toContain(server.command);
    expect(hint).toContain(config.path);
  });

  it("names the unmatched suffix and config path", () => {
    const config = load(agentDir());
    const hint = noServerHint("notes.txt", config.path);
    expect(hint).toContain(".txt");
    expect(hint).toContain(config.path);
  });
});
