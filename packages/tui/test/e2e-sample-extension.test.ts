import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  DefaultResourceLoader,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionFactory,
  ModelRegistry,
  SessionManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type ProgramStatus,
  type Terminal,
  Text,
  TuiMainScreen,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { DEFAULT_TUI_CONFIG } from "@hollowheap/core/tui-config";
import { boxFrame, getFrameInnerWidth } from "@hollowheap/tui/frame";
import {
  bindHostOutputPadding,
  resetActiveTuiConfig,
  setActiveTuiConfig,
} from "@hollowheap/tui/state";
import { paintSurfaceLine } from "@hollowheap/tui/surface";
import { TabbedContent } from "@hollowheap/tui/tabs";
import { afterEach, describe, expect, it, vi } from "vitest";

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

function createSampleTuiExtension(): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerCommand("tui-sample", {
      description: "Open sample tabbed surface frame",
      handler: async (_args, ctx) => {
        await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
          const tabs = new TabbedContent([
            {
              label: "Overview",
              content: new Text(
                "Framed surface content with long text to verify wrapping and clipping across narrow widths.",
                0,
                0,
              ),
            },
            {
              label: "Padding",
              content: new Text(
                "Symmetric host output padding and surface background painting.",
                0,
                0,
              ),
            },
          ]);

          return {
            invalidate: () => tabs.invalidate(),
            handleInput: (data: string) => {
              if (data === "\x1b") {
                done(undefined);
                return;
              }
              tabs.handleInput(data);
            },
            render: (width: number) => {
              const innerWidth = getFrameInnerWidth(width);
              const body = tabs.render(innerWidth);
              const framed = boxFrame(body, width, theme, "TUI Sample", {
                borderStyle: "rounded",
                overlaySurface: "surface",
              });
              return framed.map((line) =>
                paintSurfaceLine(line, width, theme, "surface", true),
              );
            },
          };
        });
      },
    });
  };
}

describe("packages/tui sample extension E2E", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(`${tmpdir()}/pi-tui-e2e-`);
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    resetActiveTuiConfig();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders boxFrame, TabbedContent, paintSurfaceLine, and bindHostOutputPadding across resizes", async () => {
    const terminal = new MemoryTerminal(120, 30);
    const tui = new TuiMainScreen(terminal);
    tui.start();

    const releasePadding = bindHostOutputPadding(() => 1);
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      borderStyle: "rounded",
      overlaySurface: "surface",
    });

    const commands = new Map<
      string,
      { handler: (args: string, ctx: ExtensionContext) => Promise<void> }
    >();
    const pi = {
      registerCommand: vi.fn((name, def) => {
        commands.set(name, def);
      }),
    } as unknown as ExtensionAPI;

    let mountedComponent: Component | undefined;
    let mountedDone: ((value: unknown) => void) | undefined;

    const ctx = {
      cwd: makeTempDir(),
      hasUI: true,
      mode: "tui",
      ui: {
        theme: mockTheme,
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
              mountedDone = resolvePromise;
              mountedComponent = factory(tui, mockTheme, {}, resolvePromise);
              tui.showOverlay(mountedComponent);
            }),
        ),
      },
    } as unknown as ExtensionContext;

    try {
      createSampleTuiExtension()(pi);
      const runPromise = commands.get("tui-sample")?.handler("", ctx);
      await vi.waitFor(() => expect(mountedComponent).toBeDefined());
      if (!mountedComponent)
        throw new Error("sample TUI component not mounted");

      assertRenderAcrossResizes(tui, terminal, mountedComponent);
      mountedComponent.handleInput?.("\t");
      assertRenderAcrossResizes(tui, terminal, mountedComponent);

      mountedDone?.(undefined);
      tui.hideOverlay();
      await runPromise;
    } finally {
      releasePadding();
      tui.stop();
    }
  });

  describe.runIf(process.env.PI_E2E === "1")("live SDK", () => {
    it("loads sample TUI extension and completes a prompt", async () => {
      const cwd = makeTempDir();
      const agentDir = makeTempDir();
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        noExtensions: true,
        extensionFactories: [createSampleTuiExtension()],
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
