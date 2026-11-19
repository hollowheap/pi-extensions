import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DefaultResourceLoader,
  type ExtensionAPI,
  type ExtensionContext,
  ModelRegistry,
  SessionManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type ProgramStatus,
  type Terminal,
  TuiMainScreen,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension, { createDashboard } from "../src/index.js";
import { defaultConfig, showDashboardSettings } from "../src/settings.js";
import { showDashboardOverlay } from "../src/view.js";

const EXT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../index.ts",
);
const RESIZE_STEPS = [
  [120, 30],
  [80, 24],
  [48, 20],
  [30, 16],
] as const;

class MemoryTerminal implements Terminal {
  columns: number;
  rows: number;
  readonly writes: string[] = [];
  private onResize?: () => void;

  constructor(columns = 120, rows = 30) {
    this.columns = columns;
    this.rows = rows;
  }

  get kittyProtocolActive(): boolean {
    return false;
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

  resize(columns: number, rows = this.rows): void {
    this.columns = columns;
    this.rows = rows;
    this.onResize?.();
  }

  moveBy(_lines: number): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(_title: string): void {}
  setProgress(_active: boolean): void {}
  setProgramStatus(_status: ProgramStatus): void {}
}

const mockTheme = {
  fg: (_token: string, text: string) => text,
  bg: (_token: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
  underline: (text: string) => text,
  strikethrough: (text: string) => text,
};

function assertRenderAcrossResizes(
  tui: TuiMainScreen,
  terminal: MemoryTerminal,
  component: Component,
) {
  for (const [width, height] of RESIZE_STEPS) {
    terminal.resize(width, height);
    tui.renderNow(true);
    const lines = component.render(width);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  }
  expect(terminal.writes.length).toBeGreaterThan(0);
}

describe("pi-dashboard E2E", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(`${tmpdir()}/pi-dashboard-e2e-`);
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders startup header widget and sections across terminal resizes", async () => {
    const terminal = new MemoryTerminal(120, 30);
    const tui = new TuiMainScreen(terminal);
    tui.start();

    const handlers = new Map<
      string,
      Array<(event: unknown, ctx: ExtensionContext) => Promise<void> | void>
    >();
    let headerFactory:
      | ((tui: unknown, theme: unknown) => Component)
      | undefined;

    const pi = {
      on: vi.fn((event, handler) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      }),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      events: { emit: vi.fn(), on: vi.fn(() => () => {}) },
    } as unknown as ExtensionAPI;

    const cwd = makeTempDir();
    const ctx = {
      cwd,
      hasUI: true,
      mode: "tui",
      model: { provider: "openai", id: "gpt-4o" },
      thinkingLevel: "medium",
      sessionManager: {
        getEntries: () => [],
        getBranch: () => [],
        getSessionName: () => "demo-session",
      },
      getContextUsage: () => ({ tokens: 1200, contextWindow: 128000 }),
      ui: {
        theme: mockTheme,
        notify: vi.fn(),
        setHeader: vi.fn((factory) => {
          headerFactory = factory;
        }),
        custom: vi.fn(),
      },
    } as unknown as ExtensionContext;

    try {
      extension(pi);
      for (const fn of handlers.get("session_start") ?? []) {
        await fn({}, ctx);
      }
      expect(headerFactory).toBeDefined();
      const headerComponent = headerFactory?.(tui, mockTheme);
      if (!headerComponent) throw new Error("header component not created");

      tui.addChild(headerComponent);
      assertRenderAcrossResizes(tui, terminal, headerComponent);

      const controller = createDashboard(defaultConfig(), {
        run: async () => "",
        notify: vi.fn(),
        loadSessions: async () => [
          {
            path: "/tmp/s1.jsonl",
            id: "s1",
            name: "Refactor renderer",
            firstMessage: "Check resize widths",
            created: new Date(Date.now() - 120_000),
            modified: new Date(Date.now() - 60_000),
            messageCount: 12,
            cwd,
            summary: {},
          },
        ],
        getStateInput: () => ({
          cwd,
          model: "openai/gpt-4o",
          thinking: "medium",
        }),
      });
      const dashboardComponent: Component = {
        invalidate: () => {},
        render: (width: number) => controller.lines(width, mockTheme as never),
      };
      tui.addChild(dashboardComponent);
      assertRenderAcrossResizes(tui, terminal, dashboardComponent);

      for (const fn of handlers.get("session_shutdown") ?? []) {
        await fn({}, ctx);
      }
    } finally {
      tui.stop();
    }
  });

  it("renders dashboard overlay and settings dialog across terminal resizes", async () => {
    const terminal = new MemoryTerminal(120, 30);
    const tui = new TuiMainScreen(terminal);
    tui.start();

    let pending:
      | { component: Component; done: (value: unknown) => void }
      | undefined;
    const waitMount = async () => {
      await vi.waitFor(() => expect(pending).toBeDefined());
      const current = pending;
      pending = undefined;
      if (!current) throw new Error("overlay not mounted");
      return current;
    };

    const cwd = makeTempDir();
    const ctx = {
      cwd,
      hasUI: true,
      mode: "tui",
      ui: {
        theme: mockTheme,
        notify: vi.fn(),
        custom: vi.fn(
          (
            factory: (
              t: unknown,
              theme: unknown,
              kb: unknown,
              done: (value: unknown) => void,
            ) => Component,
          ) =>
            new Promise((resolvePromise) => {
              const component = factory(tui, mockTheme, {}, resolvePromise);
              pending = { component, done: resolvePromise };
              tui.showOverlay(component);
            }),
        ),
      },
    } as unknown as ExtensionContext;

    try {
      const overlayPromise = showDashboardOverlay(ctx, {
        initialSessions: [
          {
            path: "/tmp/s1.jsonl",
            id: "s1",
            name: "Narrow terminal layout",
            firstMessage: "Verify 30 columns",
            created: new Date(Date.now() - 240_000),
            modified: new Date(Date.now() - 120_000),
            messageCount: 5,
            cwd,
            summary: {},
          },
        ],
        loadSessions: async () => [
          {
            path: "/tmp/s1.jsonl",
            id: "s1",
            name: "Narrow terminal layout",
            firstMessage: "Verify 30 columns",
            created: new Date(Date.now() - 240_000),
            modified: new Date(Date.now() - 120_000),
            messageCount: 5,
            cwd,
            summary: {},
          },
        ],
        getStateInput: () => ({
          cwd,
          model: "openai/gpt-4o",
          thinking: "low",
        }),
        snapshotOwner: {},
      });

      const overlayMount = await waitMount();
      assertRenderAcrossResizes(tui, terminal, overlayMount.component);

      overlayMount.done({ type: "close" });
      tui.hideOverlay();
      await overlayPromise;

      const settingsPromise = showDashboardSettings(
        ctx,
        defaultConfig(),
        () => {},
      );
      const settingsMount = await waitMount();
      assertRenderAcrossResizes(tui, terminal, settingsMount.component);

      settingsMount.done(undefined);
      tui.hideOverlay();
      await settingsPromise;
    } finally {
      tui.stop();
    }
  });

  describe.runIf(process.env.PI_E2E === "1")("live SDK", () => {
    it("loads pi-dashboard and completes a prompt", async () => {
      const cwd = makeTempDir();
      const agentDir = makeTempDir();
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        noExtensions: true,
        additionalExtensionPaths: [EXT_PATH],
      });
      await loader.reload();

      const { session } = await createAgentSession({
        cwd,
        agentDir,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(),
      });

      try {
        const modelRegistry = new ModelRegistry(session.modelRuntime);
        const model = modelRegistry.find(
          process.env.PI_E2E_PROVIDER ?? "opencode-go",
          process.env.PI_E2E_MODEL ?? "hy4-flash-free",
        );
        if (!model || !modelRegistry.hasConfiguredAuth(model)) {
          return;
        }
        await session.setModel(model);
        await session.prompt("Reply with exactly: ok");
        expect(session.messages.length).toBeGreaterThan(0);
      } finally {
        session.dispose();
      }
    }, 60_000);
  });
});
