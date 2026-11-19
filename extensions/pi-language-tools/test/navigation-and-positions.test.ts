import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { LspClient } from "../src/lsp.js";
import type { LanguageToolsConfig, ServerConfig } from "../src/settings.js";
import { createLangTool } from "../src/tool.js";

function server(): ServerConfig {
  return {
    name: "fake",
    command: "fake-ls",
    args: [],
    extensions: { ".ts": "typescript" },
    timeoutMs: 1_000,
    source: "config",
  };
}

function config(): LanguageToolsConfig {
  return {
    servers: [server()],
    path: "/agent/language-tools.json",
    diagnostics: [],
  };
}

function fakeClient(overrides: Partial<LspClient> = {}): LspClient {
  return {
    definition: vi.fn(async () => []),
    ...overrides,
  } as unknown as LspClient;
}

describe("lang supports navigation with 1-based positions and bounded results", () => {
  it("converts a 1-based definition request and formats the location", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-lang-tool-draw-"));
    const path = join(dir, "src", "a.ts");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "const x = 1;\n");

    const client = fakeClient({
      definition: vi.fn(async () => [
        {
          uri: pathToFileURL(path).href,
          range: {
            start: { line: 1, character: 2 },
            end: { line: 1, character: 5 },
          },
        },
      ]),
    });
    const getClient = vi.fn(() => client);
    const tool = createLangTool({
      getAgentDir: () => "/agent",
      getClient,
      loadConfig: () => config(),
      loadRules: () => [],
    });
    const ctx = {
      cwd: dir,
      sessionManager: {},
      isProjectTrusted: () => true,
      ui: { notify: vi.fn() },
    };

    const result = await tool.execute(
      "call-1",
      { action: "definition", path: "src/a.ts", line: 2, column: 3 },
      undefined,
      () => {},
      ctx as never,
    );

    expect((result.content as Array<{ text: string }>)[0].text).toBe(
      "src/a.ts:2:3",
    );
    expect(client.definition).toHaveBeenCalledWith(path, "typescript", {
      line: 1,
      character: 2,
    });
    expect(result.details).toMatchObject({
      action: "definition",
      count: 1,
      truncated: false,
    });
  });

  it("refuses navigation in an untrusted project without contacting a server", async () => {
    const getClient = vi.fn(() => fakeClient());
    const tool = createLangTool({
      getAgentDir: () => "/agent",
      getClient,
      loadConfig: () => config(),
      loadRules: () => [],
    });
    const result = await tool.execute(
      "call-2",
      { action: "definition", path: "src/a.ts", line: 1, column: 1 },
      undefined,
      undefined,
      {
        cwd: "/repo",
        sessionManager: {},
        isProjectTrusted: () => false,
        ui: { notify: vi.fn() },
      } as never,
    );
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      "trusted project",
    );
    expect(getClient).not.toHaveBeenCalled();
  });

  it("reports an unknown action as text instead of throwing", async () => {
    const tool = createLangTool({
      getAgentDir: () => "/agent",
      getClient: vi.fn(() => fakeClient()),
      loadConfig: () => config(),
      loadRules: () => [],
    });
    const result = await tool.execute(
      "call-3",
      { action: "bogus", path: "src/a.ts", line: 1, column: 1 },
      undefined,
      undefined,
      {
        cwd: "/repo",
        sessionManager: {},
        isProjectTrusted: () => true,
        ui: { notify: vi.fn() },
      } as never,
    );
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      "Unknown lang action",
    );
  });

  it("caps definition results and flags truncation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-lang-tool-draw-"));
    const path = join(dir, "src", "a.ts");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "const x = 1;\n");
    const client = fakeClient({
      definition: vi.fn(async () =>
        [1, 2, 3].map((line) => ({
          uri: pathToFileURL(path).href,
          range: {
            start: { line, character: 0 },
            end: { line, character: 1 },
          },
        })),
      ),
    });
    const tool = createLangTool({
      getAgentDir: () => "/agent",
      getClient: vi.fn(() => client),
      loadConfig: () => config(),
      loadRules: () => [],
    });
    const result = await tool.execute(
      "call-4",
      {
        action: "definition",
        path: "src/a.ts",
        line: 2,
        column: 3,
        max_results: 2,
      },
      undefined,
      undefined,
      {
        cwd: dir,
        sessionManager: {},
        isProjectTrusted: () => true,
        ui: { notify: vi.fn() },
      } as never,
    );
    expect(result.details).toMatchObject({
      action: "definition",
      count: 2,
      truncated: true,
    });
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      "... (truncated)",
    );
  });
});
