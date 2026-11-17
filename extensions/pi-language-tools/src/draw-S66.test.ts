import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { LanguageToolsConfig, ServerConfig } from "./config.js";
import type { LspClient } from "./lsp.js";
import { createLangTool } from "./tool.js";

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
  return { servers: [server()], path: "/agent/language-tools.json", diagnostics: [] };
}

function fakeClient(overrides: Partial<LspClient> = {}): LspClient {
  return {
    definition: vi.fn(async () => []),
    ...overrides,
  } as unknown as LspClient;
}

describe("S66: lang supports navigation with 1-based positions and bounded results", () => {
  it("converts a 1-based definition request and formats the location", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-lang-tool-draw-"));
    const path = join(dir, "src", "a.ts");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "const x = 1;\n");

    const client = fakeClient({
      definition: vi.fn(async () => [{
        uri: pathToFileURL(path).href,
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 5 },
        },
      }]),
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

    expect((result.content as Array<{ text: string }>)[0].text).toBe("src/a.ts:2:3");
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
});
