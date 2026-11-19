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
import extension from "../src/index.js";
import { renderStatusline } from "../src/render.js";
import { defaultConfig, showStatuslineSettings } from "../src/settings.js";

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

describe("pi-statusline E2E", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(`${tmpdir()}/pi-statusline-e2e-`);
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders footer statusline and settings overlay across terminal resizes", async () => {
    const terminal = new MemoryTerminal(120, 30);
    const tui = new TuiMainScreen(terminal);
    tui.start();

    const handlers = new Map<
      string,
      Array<(event: unknown, ctx: ExtensionContext) => Promise<void> | void>
    >();
    let footerFactory:
      | ((tui: unknown, theme: unknown, footerData: unknown) => Component)
      | undefined;
    let overlayComponent: Component | undefined;
    let overlayDone: ((value: unknown) => void) | undefined;

    const pi = {
      on: vi.fn((event, handler) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      }),
      registerCommand: vi.fn(),
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
        getSessionName: () => "statusline-session",
      },
      getContextUsage: () => ({ tokens: 2400, contextWindow: 128000 }),
      ui: {
        theme: mockTheme,
        notify: vi.fn(),
        setFooter: vi.fn((factory) => {
          footerFactory = factory;
        }),
        setWorkingIndicator: vi.fn(),
        setHiddenThinkingLabel: vi.fn(),
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
              overlayDone = resolvePromise;
              overlayComponent = factory(tui, mockTheme, {}, resolvePromise);
              tui.showOverlay(overlayComponent);
            }),
        ),
      },
    } as unknown as ExtensionContext;

    try {
      extension(pi);
      for (const fn of handlers.get("session_start") ?? []) {
        await fn({}, ctx);
      }

      expect(footerFactory).toBeDefined();
      const footerComponent = footerFactory?.(tui, mockTheme, {
        getGitBranch: () => "main",
        getExtensionStatuses: () => new Map([["mode", "ask"]]),
        onBranchChange: () => () => {},
      });
      if (!footerComponent) throw new Error("footer component not created");

      tui.addChild(footerComponent);
      assertRenderAcrossResizes(tui, terminal, footerComponent);

      const directComponent: Component = {
        invalidate: () => {},
        render: (width: number) => [
          renderStatusline(
            width,
            defaultConfig(),
            {
              cwd,
              homeDir: cwd,
              branch: "main",
              model: "gpt-4o",
              thinking: "medium",
              tokens: { input: 1200, output: 300, total: 1500 },
              contextPercent: 12,
              statuses: new Map([["mode", "ask"]]),
            } as never,
            mockTheme as never,
          ),
        ],
      };
      assertRenderAcrossResizes(tui, terminal, directComponent);

      const settingsPromise = showStatuslineSettings(
        ctx,
        defaultConfig(),
        () => {},
      );
      await vi.waitFor(() => expect(overlayComponent).toBeDefined());
      if (!overlayComponent) {
        throw new Error("statusline settings not mounted");
      }
      assertRenderAcrossResizes(tui, terminal, overlayComponent);

      overlayDone?.(undefined);
      tui.hideOverlay();
      await settingsPromise;

      for (const fn of handlers.get("session_shutdown") ?? []) {
        await fn({}, ctx);
      }
    } finally {
      tui.stop();
    }
  });

  describe.runIf(process.env.PI_E2E === "1")("live SDK", () => {
    it("loads pi-statusline and completes a prompt", async () => {
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
