import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Rule } from "@hollowheap/core";
import { describe, expect, it, vi } from "vitest";
import type { LanguageToolsConfig, ServerConfig } from "./config.js";
import type { LspClient } from "./lsp.js";
import { type LangToolDeps, createLangTool } from "./tool.js";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "pi-language-tools-tool-"));
}

function file(dir: string, relative: string, text = "const x = 1;\n"): string {
  const path = join(dir, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

function context(
  dir: string,
  options: { trusted?: boolean; rules?: Rule[] } = {},
): ExtensionContext {
  return {
    cwd: dir,
    sessionManager: {},
    isProjectTrusted: () => options.trusted ?? true,
    ui: { notify: vi.fn() },
  } as unknown as ExtensionContext;
}

function server(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    name: "fake",
    command: "fake-ls",
    args: [],
    extensions: { ".ts": "typescript" },
    timeoutMs: 1_000,
    source: "config",
    ...overrides,
  };
}

function config(servers: ServerConfig[] = [server()]): LanguageToolsConfig {
  return {
    servers,
    path: "/agent/language-tools.json",
    diagnostics: [],
  };
}

function fakeClient(overrides: Partial<LspClient> = {}): LspClient {
  return {
    definition: vi.fn(async () => []),
    references: vi.fn(async () => []),
    documentSymbols: vi.fn(async () => []),
    workspaceSymbols: vi.fn(async () => []),
    hover: vi.fn(async () => ({})),
    signatureHelp: vi.fn(async () => ({})),
    typeDefinition: vi.fn(async () => []),
    implementation: vi.fn(async () => []),
    documentHighlights: vi.fn(async () => []),
    diagnostics: vi.fn(async () => []),
    ...overrides,
  } as unknown as LspClient;
}

function setup(
  client: LspClient,
  configValue: LanguageToolsConfig = config(),
  rules: Rule[] = [],
): {
  deps: LangToolDeps;
  getClient: ReturnType<typeof vi.fn>;
  loadConfig: ReturnType<typeof vi.fn>;
  loadRules: ReturnType<typeof vi.fn>;
} {
  const getClient = vi.fn(() => client);
  const loadConfig = vi.fn(() => configValue);
  const loadRules = vi.fn(() => rules);
  return {
    deps: {
      getAgentDir: () => "/agent",
      getClient,
      loadConfig,
      loadRules,
    },
    getClient,
    loadConfig,
    loadRules,
  };
}

async function run(
  tool: ReturnType<typeof createLangTool>,
  params: Record<string, unknown>,
  ctx: ExtensionContext,
) {
  return tool.execute(
    "call-1",
    params as never,
    undefined,
    () => {},
    ctx as never,
  );
}

function textOf(result: { content: unknown }): string {
  const [first] = result.content as [{ type: string; text: string }];
  return first.text;
}

function location(path: string, line = 0, character = 0) {
  return {
    uri: pathToFileURL(path).href,
    range: {
      start: { line, character },
      end: { line, character: character + 1 },
    },
  };
}

describe("lang definition and references", () => {
  it("formats definition locations and converts 1-based positions", async () => {
    const dir = workspace();
    const path = file(dir, "src/a.ts");
    const client = fakeClient({
      definition: vi.fn(async () => [location(path)]),
    });
    const { deps, getClient } = setup(client);
    const tool = createLangTool(deps);

    const result = await run(
      tool,
      { action: "definition", path: "src/a.ts", line: 2, column: 3 },
      context(dir),
    );

    expect(textOf(result)).toBe("src/a.ts:1:1");
    expect(client.definition).toHaveBeenCalledWith(path, "typescript", {
      line: 1,
      character: 2,
    });
    expect(getClient).toHaveBeenCalledWith({
      name: "fake",
      command: "fake-ls",
      args: [],
      root: dir,
      timeoutMs: 1_000,
    });
    expect(result.details).toMatchObject({
      action: "definition",
      path: "src/a.ts",
      count: 1,
      truncated: false,
    });
  });

  it("formats reference locations and supports a single result", async () => {
    const dir = workspace();
    const path = file(dir, "src/a.ts");
    const client = fakeClient({
      references: vi.fn(async () => location(path, 4, 5)),
    });
    const { deps } = setup(client);
    const tool = createLangTool(deps);

    const result = await run(
      tool,
      { action: "references", path: "src/a.ts", line: 1, column: 1 },
      context(dir),
    );

    expect(textOf(result)).toBe("src/a.ts:5:6");
  });

  it("drops denied locations and reports truncation", async () => {
    const dir = workspace();
    const allowed = file(dir, "src/a.ts");
    const denied = file(dir, "secret/b.ts");
    const client = fakeClient({
      definition: vi.fn(async () => [
        location(allowed, 0, 0),
        location(denied, 1, 0),
        location(allowed, 2, 0),
      ]),
    });
    const { deps } = setup(client, config(), [
      { tag: "read", pattern: "secret/**", effect: "deny" },
    ]);
    const tool = createLangTool(deps);

    const result = await run(
      tool,
      {
        action: "definition",
        path: "src/a.ts",
        line: 1,
        column: 1,
        max_results: 1,
      },
      context(dir),
    );

    expect(textOf(result)).toBe("src/a.ts:1:1\n... (truncated)");
    expect(result.details).toMatchObject({ count: 1, truncated: true });
  });

  it("returns empty text for no results", async () => {
    const dir = workspace();
    file(dir, "src/a.ts");
    const client = fakeClient({
      definition: vi.fn(async () => null),
    });
    const { deps } = setup(client);
    const tool = createLangTool(deps);

    const result = await run(
      tool,
      { action: "definition", path: "src/a.ts", line: 1, column: 1 },
      context(dir),
    );

    expect(textOf(result)).toBe("No definitions found.");
    expect(result.details).toMatchObject({ count: 0, truncated: false });
  });
});

describe("lang symbols", () => {
  it("formats hierarchical document symbols and flat symbol information", async () => {
    const dir = workspace();
    const path = file(dir, "src/a.ts");
    const client = fakeClient({
      documentSymbols: vi.fn(async () => [
        {
          name: "hello",
          kind: 12,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 1, character: 0 },
          },
          selectionRange: {
            start: { line: 0, character: 4 },
            end: { line: 0, character: 9 },
          },
          children: [
            {
              name: "inner",
              kind: 6,
              range: {
                start: { line: 1, character: 0 },
                end: { line: 1, character: 9 },
              },
              selectionRange: {
                start: { line: 1, character: 2 },
                end: { line: 1, character: 7 },
              },
            },
          ],
        },
        {
          name: "other",
          kind: 13,
          location: location(path, 2, 0),
        },
        {
          name: "unknown",
          kind: 0,
          location: location(path, 3, 0),
        },
      ]),
    });
    const { deps } = setup(client);
    const tool = createLangTool(deps);

    const result = await run(
      tool,
      { action: "document_symbols", path: "src/a.ts" },
      context(dir),
    );

    expect(textOf(result)).toBe(
      "hello (function) src/a.ts:1\n  inner (method) src/a.ts:2\nother (variable) src/a.ts:3\nunknown (symbol) src/a.ts:4",
    );
  });

  it("formats workspace symbols with the selected server", async () => {
    const dir = workspace();
    const path = file(dir, "src/a.ts");
    const client = fakeClient({
      workspaceSymbols: vi.fn(async () => [
        {
          name: "hello",
          kind: 12,
          location: location(path, 2, 3),
          containerName: "mod",
        },
      ]),
    });
    const { deps } = setup(client);
    const tool = createLangTool(deps);

    const result = await run(
      tool,
      {
        action: "workspace_symbols",
        path: "src/a.ts",
        query: "hello",
      },
      context(dir),
    );

    expect(textOf(result)).toBe("src/a.ts:3:4 hello (function) [mod]");
    expect(client.workspaceSymbols).toHaveBeenCalledWith("hello");
  });

  it("drops malformed and non-file symbol results", async () => {
    const dir = workspace();
    file(dir, "src/a.ts");
    const client = fakeClient({
      documentSymbols: vi.fn(async () => [null, { name: 1 }]),
      workspaceSymbols: vi.fn(async () => [
        { name: "remote", kind: 1, location: { uri: "https://example.com" } },
      ]),
    });
    const { deps } = setup(client);
    const tool = createLangTool(deps);

    const symbols = await run(
      tool,
      { action: "document_symbols", path: "src/a.ts" },
      context(dir),
    );
    expect(textOf(symbols)).toBe("No symbols found.");

    const workspaceResult = await run(
      tool,
      {
        action: "workspace_symbols",
        path: "src/a.ts",
        query: "remote",
      },
      context(dir),
    );
    expect(textOf(workspaceResult)).toBe("No workspace symbols found.");
  });
});

describe("lang extended actions", () => {
  it("formats signature help, type definitions, implementations, highlights, and diagnostics", async () => {
    const dir = workspace();
    const path = file(dir, "src/a.ts");
    const client = fakeClient({
      signatureHelp: vi.fn(async () => ({
        signatures: [
          {
            label: "fn(x: number)",
            documentation: "Does things",
            parameters: [{ label: "x: number", documentation: "the x value" }],
          },
        ],
        activeSignature: 0,
        activeParameter: 0,
      })),
      typeDefinition: vi.fn(async () => [location(path)]),
      implementation: vi.fn(async () => [location(path)]),
      documentHighlights: vi.fn(async () => [
        {
          range: {
            start: { line: 2, character: 1 },
            end: { line: 2, character: 2 },
          },
          kind: 2,
        },
      ]),
      diagnostics: vi.fn(async () => [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 2 },
          },
          severity: 1,
          message: "bad",
          code: 2322,
          source: "ts",
        },
      ]),
    });
    const { deps } = setup(client);
    const tool = createLangTool(deps);
    const ctx = context(dir);
    const position = { path: "src/a.ts", line: 1, column: 1 };

    const signature = await run(
      tool,
      { action: "signature_help", ...position },
      ctx,
    );
    expect(textOf(signature)).toContain("fn(x: number)");
    expect(textOf(signature)).toContain("the x value");

    const typeDefinition = await run(
      tool,
      { action: "type_definition", ...position },
      ctx,
    );
    expect(textOf(typeDefinition)).toContain("src/a.ts:1:1");

    const implementation = await run(
      tool,
      { action: "implementation", ...position },
      ctx,
    );
    expect(textOf(implementation)).toContain("src/a.ts:1:1");

    const highlights = await run(
      tool,
      { action: "document_highlights", ...position },
      ctx,
    );
    expect(textOf(highlights)).toBe("src/a.ts:3:2 read");

    const diagnostics = await run(
      tool,
      { action: "diagnostics", path: "src/a.ts" },
      ctx,
    );
    expect(textOf(diagnostics)).toBe("src/a.ts:1:2 error ts: bad [2322]");
  });
});

describe("lang validation and policy", () => {
  it("rejects unknown actions before starting a server", async () => {
    const dir = workspace();
    const { deps, getClient } = setup(fakeClient());
    const tool = createLangTool(deps);

    const result = await run(
      tool,
      { action: "bogus", path: "src/a.ts" },
      context(dir),
    );

    expect(textOf(result)).toContain("Unknown lang action");
    expect(getClient).not.toHaveBeenCalled();
  });

  it("requires a path for every action", async () => {
    const dir = workspace();
    const { deps, getClient } = setup(fakeClient());
    const tool = createLangTool(deps);

    const result = await run(
      tool,
      { action: "definition", line: 1, column: 1 },
      context(dir),
    );

    expect(textOf(result)).toBe("definition requires a path.");
    expect(getClient).not.toHaveBeenCalled();
  });

  it("requires 1-based positions for definition and references", async () => {
    const dir = workspace();
    file(dir, "src/a.ts");
    const { deps, getClient } = setup(fakeClient());
    const tool = createLangTool(deps);

    const result = await run(
      tool,
      { action: "definition", path: "src/a.ts" },
      context(dir),
    );
    expect(textOf(result)).toBe("definition requires 1-based line and column.");

    const zero = await run(
      tool,
      { action: "references", path: "src/a.ts", line: 0, column: 1 },
      context(dir),
    );
    expect(textOf(zero)).toBe("references requires 1-based line and column.");
    expect(getClient).not.toHaveBeenCalled();
  });

  it("requires a query for workspace symbols", async () => {
    const dir = workspace();
    file(dir, "src/a.ts");
    const { deps, getClient } = setup(fakeClient());
    const tool = createLangTool(deps);

    const result = await run(
      tool,
      { action: "workspace_symbols", path: "src/a.ts" },
      context(dir),
    );

    expect(textOf(result)).toBe("workspace_symbols requires a query.");
    expect(getClient).not.toHaveBeenCalled();
  });

  it("rejects untrusted projects before loading config or starting a server", async () => {
    const dir = workspace();
    file(dir, "src/a.ts");
    const { deps, getClient, loadConfig } = setup(fakeClient());
    const tool = createLangTool(deps);

    const result = await run(
      tool,
      { action: "definition", path: "src/a.ts", line: 1, column: 1 },
      context(dir, { trusted: false }),
    );

    expect(textOf(result)).toContain("trusted project");
    expect(loadConfig).not.toHaveBeenCalled();
    expect(getClient).not.toHaveBeenCalled();
  });

  it("rejects a denied target before starting a server", async () => {
    const dir = workspace();
    file(dir, "secret/a.ts");
    const { deps, getClient, loadConfig } = setup(fakeClient(), config(), [
      { tag: "read", pattern: "secret/**", effect: "deny" },
    ]);
    const tool = createLangTool(deps);

    const result = await run(
      tool,
      { action: "definition", path: "secret/a.ts", line: 1, column: 1 },
      context(dir),
    );

    expect(textOf(result)).toContain("Path denied");
    expect(loadConfig).not.toHaveBeenCalled();
    expect(getClient).not.toHaveBeenCalled();
  });

  it("rejects a path outside the workspace", async () => {
    const dir = workspace();
    file(dir, "src/a.ts");
    const { deps, getClient } = setup(fakeClient());
    const tool = createLangTool(deps);

    const result = await run(
      tool,
      { action: "definition", path: "/etc/passwd", line: 1, column: 1 },
      context(dir),
    );

    expect(textOf(result)).toContain("Path denied");
    expect(getClient).not.toHaveBeenCalled();
  });

  it("returns a setup hint when no server matches", async () => {
    const dir = workspace();
    file(dir, "src/a.ts");
    const { deps, getClient } = setup(fakeClient(), config([]));
    const tool = createLangTool(deps);

    const result = await run(
      tool,
      { action: "definition", path: "src/a.ts", line: 1, column: 1 },
      context(dir),
    );

    expect(textOf(result)).toContain("No language server configured for .ts");
    expect(getClient).not.toHaveBeenCalled();
  });

  it("returns a setup hint for a missing command", async () => {
    const dir = workspace();
    file(dir, "src/a.ts");
    const client = fakeClient({
      definition: vi.fn(async () => {
        throw new Error("fake: failed to start: spawn fake-ls ENOENT");
      }),
    });
    const { deps } = setup(client);
    const tool = createLangTool(deps);

    const result = await run(
      tool,
      { action: "definition", path: "src/a.ts", line: 1, column: 1 },
      context(dir),
    );

    expect(textOf(result)).toContain('Language server "fake-ls" was not found');
    expect(textOf(result)).toContain("/agent/language-tools.json");
  });

  it("returns text for a timeout instead of throwing", async () => {
    const dir = workspace();
    file(dir, "src/a.ts");
    const client = fakeClient({
      definition: vi.fn(async () => {
        throw new Error("fake: textDocument/definition timed out after 1000ms");
      }),
    });
    const { deps } = setup(client);
    const tool = createLangTool(deps);

    const result = await run(
      tool,
      { action: "definition", path: "src/a.ts", line: 1, column: 1 },
      context(dir),
    );

    expect(textOf(result)).toContain("timed out");
  });

  it("returns text when config loading throws", async () => {
    const dir = workspace();
    file(dir, "src/a.ts");
    const { deps } = setup(fakeClient());
    deps.loadConfig = () => {
      throw new Error("config exploded");
    };
    const tool = createLangTool(deps);

    const result = await run(
      tool,
      { action: "definition", path: "src/a.ts", line: 1, column: 1 },
      context(dir),
    );

    expect(textOf(result)).toContain("config exploded");
  });

  it("forwards config diagnostics as notifications", async () => {
    const dir = workspace();
    file(dir, "src/a.ts");
    const client = fakeClient();
    const getClient = vi.fn(() => client);
    const deps: LangToolDeps = {
      getAgentDir: () => "/agent",
      getClient,
      loadConfig: (_agentDir, onDiagnostic) => {
        onDiagnostic?.("bad server");
        return config();
      },
      loadRules: () => [],
    };
    const tool = createLangTool(deps);
    const ctx = context(dir);

    await run(
      tool,
      { action: "definition", path: "src/a.ts", line: 1, column: 1 },
      ctx,
    );

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "pi-language-tools: bad server",
      "warning",
    );
  });

  it("renders collapsed previews and expanded Markdown results", () => {
    const tool = createLangTool(setup(fakeClient()).deps);
    const theme = {
      fg: (_token: string, text: string) => text,
      bold: (text: string) => text,
      italic: (text: string) => text,
      underline: (text: string) => text,
      strikethrough: (text: string) => text,
    } as never;
    const result = {
      content: [
        {
          type: "text",
          text: Array.from(
            { length: 10 },
            (_, index) => `line ${index + 1}`,
          ).join("\n"),
        },
      ],
      details: {},
    };

    const collapsed = tool.renderResult?.(
      result as never,
      { expanded: false, isPartial: false },
      theme,
      {} as never,
    );
    const collapsedText = collapsed?.render(80).join("\n") ?? "";
    expect(collapsedText).toContain("line 8");
    expect(collapsedText).not.toContain("line 9");
    expect(collapsedText).toContain("expand to see more");

    const expanded = tool.renderResult?.(
      result as never,
      { expanded: true, isPartial: false },
      theme,
      {} as never,
    );
    expect(expanded?.render(80).join("\n")).toContain("line 10");
  });
});
