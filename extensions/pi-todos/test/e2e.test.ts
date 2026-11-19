import { mkdtempSync, rmSync } from "node:fs";
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
import todosExtension from "../src/index.js";

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
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("extensions/pi-todos E2E", () => {
  it("creates todos, renders widget and /todos overlay across 120 -> 80 -> 44 resizes", async () => {
    const tools = new Map<
      string,
      { execute: (...args: never[]) => Promise<unknown> }
    >();
    const commands = new Map<
      string,
      (args: string, ctx: never) => Promise<void>
    >();
    const widgets = new Map<
      string,
      (tui: unknown, theme: unknown) => Component
    >();

    const mockPi = {
      on: vi.fn(() => () => {}),
      events: {
        on: vi.fn(),
        emit: vi.fn(),
      },
      registerCommand: (
        name: string,
        def: { handler: (args: string, ctx: never) => Promise<void> },
      ) => {
        commands.set(name, def.handler);
      },
      registerShortcut: vi.fn(),
      appendEntry: vi.fn(),
      registerTool: (def: {
        name: string;
        execute: (...args: never[]) => Promise<unknown>;
      }) => {
        tools.set(def.name, def);
      },
      getActiveTools: vi.fn(() => []),
      getAllTools: vi.fn(() => []),
      setActiveTools: vi.fn(),
    };

    todosExtension(mockPi as unknown as ExtensionAPI);

    const terminal = new MemoryTerminal(140, 30);
    const tui = new TuiMainScreen(terminal);
    const theme = {
      fg: (_token: string, text: string) => text,
      bg: (_token: string, text: string) => text,
      bold: (text: string) => text,
    };

    const renderAcrossWidths = (component: Component) => {
      tui.start();
      try {
        tui.addChild(component);
        for (const width of [120, 80, 44]) {
          terminal.writes = [];
          terminal.resize(width, 30);
          tui.renderNow(false);
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

    const ctx = {
      hasUI: true,
      mode: "tui",
      sessionManager: { getBranch: vi.fn(() => []) },
      ui: {
        theme,
        notify: vi.fn(),
        setStatus: vi.fn(),
        setWidget: (
          key: string,
          factory: ((t: unknown, th: unknown) => Component) | undefined,
        ) => {
          if (factory) widgets.set(key, factory);
          else widgets.delete(key);
        },
        onTerminalInput: vi.fn(() => () => {}),
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

    const todoTool = tools.get("todo");
    expect(todoTool).toBeDefined();

    await todoTool?.execute(
      "todo-1" as never,
      {
        action: "create",
        tasks: [
          "Write headless E2E tests for pi-todos",
          "Verify terminal resize behavior at 120, 80, and 44 columns",
        ],
      } as never,
      undefined as never,
      undefined as never,
      ctx as never,
    );

    expect(widgets.size).toBeGreaterThan(0);
    for (const factory of widgets.values()) {
      const widgetComponent = factory(tui, theme);
      renderAcrossWidths(widgetComponent);
    }

    const todosCmd = commands.get("todos");
    expect(todosCmd).toBeDefined();
    await todosCmd?.("", ctx as never);
    expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
  });

  describe.runIf(process.env.PI_E2E === "1")("live SDK E2E", () => {
    it("loads pi-todos extension and completes a prompt", async (t) => {
      const root = mkdtempSync(join(tmpdir(), "pi-todos-sdk-"));
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
      if (!model || !modelRegistry.hasConfiguredAuth(model)) {
        t.skip();
        return;
      }

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
        expect(session.getLastAssistantText()?.trim().length).toBeGreaterThan(
          0,
        );
      } finally {
        session.dispose();
      }
    }, 60_000);
  });
});
