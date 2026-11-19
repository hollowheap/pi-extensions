import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DefaultResourceLoader,
  type ExtensionAPI,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  createAgentSession,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  KeybindingsManager,
  type Terminal,
  TuiMainScreen,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ agentDir: "" }));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    getAgentDir: () => state.agentDir || actual.getAgentDir(),
  };
});

import webExtension from "../src/index.js";

class MemoryTerminal implements Terminal {
  columns: number;
  rows: number;
  writes: string[] = [];
  private onResize?: () => void;

  constructor(columns = 120, rows = 30) {
    this.columns = columns;
    this.rows = rows;
  }

  start(_onInput: (data: string) => void, onResize: () => void): void {
    this.onResize = onResize;
  }

  stop(): void {
    this.onResize = undefined;
  }

  async drainInput(): Promise<void> {}

  write(data: string): void {
    this.writes.push(data);
  }

  get kittyProtocolActive(): boolean {
    return false;
  }

  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
  setProgramStatus(): void {}

  resize(columns: number, rows = this.rows): void {
    this.columns = columns;
    this.rows = rows;
    this.onResize?.();
  }
}

const tempDirs: string[] = [];

afterEach(() => {
  state.agentDir = "";
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("extensions/pi-web E2E", () => {
  it("renders tool call/result and /web settings overlay across 120 -> 80 -> 44 resizes", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-web-e2e-"));
    tempDirs.push(root);
    state.agentDir = join(root, "agent");
    mkdirSync(state.agentDir, { recursive: true });

    const tools = new Map<
      string,
      {
        renderCall?: (
          args: Record<string, unknown>,
          theme: unknown,
        ) => Component;
        renderResult?: (
          result: {
            content: Array<{ type: string; text: string }>;
            details?: unknown;
          },
          options: { expanded: boolean; isPartial: boolean },
          theme: unknown,
        ) => Component;
      }
    >();
    const commands = new Map<
      string,
      (args: string, ctx: never) => Promise<void>
    >();

    const mockPi = {
      on: vi.fn(),
      registerTool: (def: {
        name: string;
        renderCall?: (
          args: Record<string, unknown>,
          theme: unknown,
        ) => Component;
        renderResult?: (
          result: {
            content: Array<{ type: string; text: string }>;
            details?: unknown;
          },
          options: { expanded: boolean; isPartial: boolean },
          theme: unknown,
        ) => Component;
      }) => {
        tools.set(def.name, def);
      },
      registerCommand: (
        name: string,
        def: { handler: (args: string, ctx: never) => Promise<void> },
      ) => {
        commands.set(name, def.handler);
      },
      appendEntry: vi.fn(),
      getAllTools: vi.fn(() => []),
      getActiveTools: vi.fn(() => []),
      setActiveTools: vi.fn(),
    };

    webExtension(mockPi as unknown as ExtensionAPI);

    const terminal = new MemoryTerminal(120, 30);
    const tui = new TuiMainScreen(terminal);
    const theme = {
      fg: (_token: string, text: string) => text,
      bg: (_token: string, text: string) => text,
      bold: (text: string) => text,
      italic: (text: string) => text,
      underline: (text: string) => text,
      strikethrough: (text: string) => text,
    };

    const renderAcrossWidths = (component: Component) => {
      tui.start();
      try {
        tui.addChild(component);
        for (const width of [120, 80, 44]) {
          terminal.writes = [];
          terminal.resize(width, 30);
          tui.renderNow(true);
          expect(terminal.writes.length).toBeGreaterThan(0);

          const lines = tui.render(width);
          expect(lines.length).toBeGreaterThan(0);
          for (const line of lines) {
            expect(visibleWidth(line)).toBeLessThanOrEqual(width);
          }
        }
      } finally {
        tui.removeChild(component);
        tui.stop();
      }
    };

    const webSearch = tools.get("web_search");
    expect(webSearch).toBeDefined();
    if (webSearch?.renderCall) {
      const callComponent = webSearch.renderCall(
        { query: "pi-extensions headless TUI testing", max_results: 5 },
        theme,
      );
      renderAcrossWidths(callComponent);
    }
    if (webSearch?.renderResult) {
      const resultComponent = webSearch.renderResult(
        {
          content: [
            { type: "text", text: "1. Result title - https://example.com" },
          ],
          details: {
            results: [{ title: "Result title", url: "https://example.com" }],
          },
        },
        { expanded: true, isPartial: false },
        theme,
      );
      renderAcrossWidths(resultComponent);
    }

    const ctx = {
      cwd: root,
      hasUI: true,
      mode: "tui",
      ui: {
        notify: vi.fn(),
        pasteToEditor: vi.fn(),
        custom: vi.fn(
          async (
            factory: (
              tuiArg: TuiMainScreen,
              themeArg: typeof theme,
              kb: KeybindingsManager,
              done: (value: unknown) => void,
            ) => Component,
          ) => {
            let resolved: unknown;
            const component = factory(
              tui,
              theme,
              new KeybindingsManager({}),
              (value) => {
                resolved = value;
              },
            );
            renderAcrossWidths(component);
            return resolved;
          },
        ),
      },
    };

    const webCmd = commands.get("web");
    expect(webCmd).toBeDefined();
    await webCmd?.("settings", ctx as never);
    expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
  });

  describe.runIf(process.env.PI_E2E === "1")("live SDK E2E", () => {
    it("loads pi-web extension and completes a prompt", async () => {
      const root = mkdtempSync(join(tmpdir(), "pi-web-sdk-"));
      tempDirs.push(root);
      const agentDir = getAgentDir();
      const modelRuntime = await ModelRuntime.create({
        authPath: join(agentDir, "auth.json"),
        modelsPath: join(agentDir, "models.json"),
      });
      const modelRegistry = new ModelRegistry(modelRuntime);
      const provider = process.env.PI_E2E_PROVIDER ?? "opencode-go";
      const modelId = process.env.PI_E2E_MODEL ?? "hy4-flash-free";
      const model = modelRegistry.find(provider, modelId);
      expect(model).toBeDefined();

      const extDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
      const loader = new DefaultResourceLoader({
        cwd: root,
        agentDir,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        additionalExtensionPaths: [extDir],
      });
      await loader.reload();

      const { session } = await createAgentSession({
        cwd: root,
        agentDir,
        model,
        modelRuntime,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(),
        noTools: "all",
      });

      try {
        await session.prompt("Reply with exactly: OK");
        expect(session.state.messages.length).toBeGreaterThan(0);
      } finally {
        session.dispose();
      }
    }, 60_000);
  });
});
