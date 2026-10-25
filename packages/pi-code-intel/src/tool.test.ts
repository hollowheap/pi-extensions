import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Rule } from "@hollowheap/core";
import { describe, expect, it, vi } from "vitest";
import type { CodeIntelConfig, ServerConfig } from "./config.js";
import {
  type CodeIntelClient,
  type CodeIntelDeps,
  createCodeIntelTool,
} from "./tool.js";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "pi-code-intel-tool-"));
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

function config(servers: ServerConfig[] = [server()]): CodeIntelConfig {
  return {
    servers,
    exposure: "direct",
    path: "/agent/code-intel.json",
    diagnostics: [],
  };
}

function fakeClient(overrides: Partial<CodeIntelClient> = {}): CodeIntelClient {
  return {
    definition: vi.fn(async () => []),
    references: vi.fn(async () => []),
    documentSymbols: vi.fn(async () => []),
    workspaceSymbols: vi.fn(async () => []),
    ...overrides,
  };
}

function setup(
  client: CodeIntelClient,
  configValue: CodeIntelConfig = config(),
  rules: Rule[] = [],
): {
  deps: CodeIntelDeps;
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
  tool: ReturnType<typeof createCodeIntelTool>,
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

describe("code_intel definition and references", () => {
  it("formats definition locations and converts 1-based positions", async () => {
    const dir = workspace();
    const path = file(dir, "src/a.ts");
    const client = fakeClient({
      definition: vi.fn(async () => [location(path)]),
    });
    const { deps, getClient } = setup(client);
    const tool = createCodeIntelTool(deps);

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
    const tool = createCodeIntelTool(deps);

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
    const tool = createCodeIntelTool(deps);

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
    const tool = createCodeIntelTool(deps);

    const result = await run(
      tool,
      { action: "definition", path: "src/a.ts", line: 1, column: 1 },
      context(dir),
    );

    expect(textOf(result)).toBe("No definitions found.");
    expect(result.details).toMatchObject({ count: 0, truncated: false });
  });
});

describe("code_intel symbols", () => {
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
    const tool = createCodeIntelTool(deps);

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
    const tool = createCodeIntelTool(deps);

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
    const tool = createCodeIntelTool(deps);

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

describe("code_intel validation and policy", () => {
  it("requires a path for every action", async () => {
    const dir = workspace();
    const { deps, getClient } = setup(fakeClient());
    const tool = createCodeIntelTool(deps);

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
    const tool = createCodeIntelTool(deps);

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
    const tool = createCodeIntelTool(deps);

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
    const tool = createCodeIntelTool(deps);

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
    const tool = createCodeIntelTool(deps);

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
    const tool = createCodeIntelTool(deps);

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
    const tool = createCodeIntelTool(deps);

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
    const tool = createCodeIntelTool(deps);

    const result = await run(
      tool,
      { action: "definition", path: "src/a.ts", line: 1, column: 1 },
      context(dir),
    );

    expect(textOf(result)).toContain('Language server "fake-ls" was not found');
    expect(textOf(result)).toContain("/agent/code-intel.json");
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
    const tool = createCodeIntelTool(deps);

    const result = await run(
      tool,
      { action: "definition", path: "src/a.ts", line: 1, column: 1 },
      context(dir),
    );

    expect(textOf(result)).toContain("timed out");
  });

  it("forwards config diagnostics as notifications", async () => {
    const dir = workspace();
    file(dir, "src/a.ts");
    const client = fakeClient();
    const getClient = vi.fn(() => client);
    const deps: CodeIntelDeps = {
      getAgentDir: () => "/agent",
      getClient,
      loadConfig: (_agentDir, onDiagnostic) => {
        onDiagnostic?.("bad server");
        return config();
      },
      loadRules: () => [],
    };
    const tool = createCodeIntelTool(deps);
    const ctx = context(dir);

    await run(
      tool,
      { action: "definition", path: "src/a.ts", line: 1, column: 1 },
      ctx,
    );

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "pi-code-intel: bad server",
      "warning",
    );
  });
});
