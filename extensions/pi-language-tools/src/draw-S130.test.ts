import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { LanguageToolsConfig } from "./config.js";
import type { LspClient } from "./lsp.js";
import { createLangTool } from "./tool.js";

describe("S130 hover tool", () => {
  it("returns structured hover type/signature/docs from the language server", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s130-lsp-"));
    const path = join(dir, "src", "a.ts");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "const x = 1;\n");

    const client = {
      hover: vi.fn(async () => ({
        contents: "(variable) x: number\nDocumentation for x",
      })),
    } as unknown as LspClient;
    const config = {
      servers: [
        {
          name: "fake",
          command: "fake-ls",
          args: [],
          extensions: { ".ts": "typescript" },
          timeoutMs: 1_000,
          source: "config",
        },
      ],
      path: "/agent/language-tools.json",
      diagnostics: [],
    } as LanguageToolsConfig;
    const tool = createLangTool({
      getAgentDir: () => "/agent",
      loadConfig: () => config,
      loadRules: () => [],
      getClient: () => client,
    });
    const ctx = {
      cwd: dir,
      sessionManager: {},
      isProjectTrusted: () => true,
      ui: { notify: vi.fn() },
    };

    const result = await tool.execute(
      "call-1",
      { action: "hover", path: "src/a.ts", line: 1, column: 1 } as never,
      undefined,
      () => {},
      ctx as never,
    );
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("x: number");
    expect(text).toContain("Documentation for x");
  });
});
