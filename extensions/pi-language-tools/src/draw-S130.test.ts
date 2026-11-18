import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { LanguageToolsConfig } from "./config.js";
import type { LspClient } from "./lsp.js";
import { createLangTool } from "./tool.js";

function setupHover(hover: (...args: unknown[]) => unknown, trusted = true) {
  const dir = mkdtempSync(join(tmpdir(), "s130-hover-"));
  const path = join(dir, "src", "a.ts");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "const x = 1;\n");
  const client = { hover: vi.fn(hover) } as unknown as LspClient;
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
    isProjectTrusted: () => trusted,
    ui: { notify: vi.fn() },
  };
  return { tool, ctx, client };
}

async function hoverText(
  tool: ReturnType<typeof createLangTool>,
  ctx: unknown,
): Promise<string> {
  const result = await tool.execute(
    "call",
    { action: "hover", path: "src/a.ts", line: 1, column: 1 } as never,
    undefined,
    () => {},
    ctx as never,
  );
  return (result.content as Array<{ text: string }>)[0].text;
}

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

  it("S130 C02: an empty hover response reports no information", async () => {
    const { tool, ctx } = setupHover(async () => ({ contents: [] }));
    expect(await hoverText(tool, ctx)).toBe("No hover info.");
  });

  it("S130 C03: a language-server failure is returned as text, not thrown", async () => {
    const { tool, ctx } = setupHover(async () => {
      throw new Error("server exploded");
    });
    expect(await hoverText(tool, ctx)).toContain("lang: server exploded");
  });

  it("S130 C04: an untrusted project is refused before the server is used", async () => {
    const { tool, ctx, client } = setupHover(
      async () => ({
        contents: "secret",
      }),
      false,
    );
    expect(await hoverText(tool, ctx)).toContain("requires a trusted project");
    expect(client.hover).not.toHaveBeenCalled();
  });
});
