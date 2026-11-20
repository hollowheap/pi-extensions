import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BashExecutionComponent,
  DefaultResourceLoader,
  type ExtensionContext,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type ProgramStatus,
  type Terminal,
  TuiMainScreen,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { DEFAULT_TUI_CONFIG } from "@hollowheap/core/tui-config";
import {
  bindHostOutputPadding,
  resetActiveTuiConfig,
  setActiveTuiConfig,
} from "@hollowheap/tui/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModalEditor } from "../src/editor.js";
import { framePanelLines } from "../src/panel.js";
import { showTuiSettings } from "../src/settings.js";
import { installBashPanel } from "../src/skill-panel.js";

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

function stripCursorMarkers(line: string): string {
  let result = "";
  for (let index = 0; index < line.length; index++) {
    if (line.startsWith("\x1b_pi:", index)) {
      const end = line.indexOf("\x07", index);
      if (end !== -1) {
        index = end;
        continue;
      }
    }
    result += line[index];
  }
  return result;
}

const mockTheme = {
  fg: (_token: string, text: string) => text,
  bg: (_token: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
  underline: (text: string) => text,
  strikethrough: (text: string) => text,
};

const editorTheme = {
  borderColor: (value: string) => value,
  selectList: {
    selectedPrefix: (value: string) => value,
    selectedText: (value: string) => value,
    description: (value: string) => value,
    scrollInfo: (value: string) => value,
  },
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
      expect(visibleWidth(stripCursorMarkers(line))).toBeLessThanOrEqual(width);
    }
  }
  expect(terminal.writes.length).toBeGreaterThan(0);
}

describe("pi-modal E2E", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(`${tmpdir()}/pi-modal-e2e-`);
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    resetActiveTuiConfig();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders ModalEditor across bordered and surface modes on terminal resize", () => {
    const terminal = new MemoryTerminal(120, 30);
    const tui = new TuiMainScreen(terminal);
    tui.start();

    const releasePad = bindHostOutputPadding(() => 1);
    try {
      const borderedEditor = new ModalEditor(
        tui as never,
        editorTheme as never,
        { matches: vi.fn(() => false) } as never,
        { initialMode: "insert", borderStyle: "rounded" },
        undefined,
        mockTheme as never,
      );
      borderedEditor.setText("const message = 'resize across narrow widths';");
      tui.addChild(borderedEditor);
      assertRenderAcrossResizes(tui, terminal, borderedEditor);

      setActiveTuiConfig({
        ...DEFAULT_TUI_CONFIG,
        borderStyle: "none",
        overlaySurface: "surface",
      });
      const surfaceEditor = new ModalEditor(
        tui as never,
        editorTheme as never,
        { matches: vi.fn(() => false) } as never,
        { initialMode: "normal", borderStyle: "none" },
        undefined,
        mockTheme as never,
      );
      surfaceEditor.setText("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ");
      tui.addChild(surfaceEditor);
      assertRenderAcrossResizes(tui, terminal, surfaceEditor);

      const narrowRows = surfaceEditor
        .render(30)
        .map((line) => stripTerminalSequences(stripCursorMarkers(line)));
      expect(narrowRows.some((row) => row.startsWith("█ "))).toBe(true);
      for (const row of narrowRows) {
        expect(visibleWidth(row)).toBeLessThanOrEqual(30);
      }
    } finally {
      releasePad();
      tui.stop();
    }
  });

  it("renders framePanelLines and installBashPanel across terminal resizes", () => {
    initTheme();
    const terminal = new MemoryTerminal(120, 30);
    const tui = new TuiMainScreen(terminal);
    tui.start();

    try {
      for (const [borderStyle, surface] of [
        ["rounded", "transparent"],
        ["none", "surface"],
        ["none", "card"],
      ] as const) {
        const panelComponent: Component = {
          invalidate: () => {},
          render: (width: number) =>
            framePanelLines(
              [
                "Running command with a long output line that needs truncation",
                "exit code: 0",
              ],
              width,
              mockTheme as never,
              {
                borderStyle,
                accentStripe: true,
                outputPad: 1,
                stateToken: "toolPendingBg",
                includeTop: true,
                includeBottom: true,
                surface,
              },
            ),
        };
        assertRenderAcrossResizes(tui, terminal, panelComponent);
      }

      installBashPanel(() => mockTheme as never);
      const bash = new BashExecutionComponent(
        "echo 'hello from bash panel'",
        tui,
      );
      bash.appendOutput("line 1\nline 2 with enough text to wrap or truncate");
      bash.setComplete(0, false);
      tui.addChild(bash);
      assertRenderAcrossResizes(tui, terminal, bash);
    } finally {
      tui.stop();
    }
  });

  it("renders showTuiSettings overlay across terminal resizes", async () => {
    const terminal = new MemoryTerminal(120, 30);
    const tui = new TuiMainScreen(terminal);
    tui.start();

    let overlayComponent: Component | undefined;
    let overlayDone: ((value: unknown) => void) | undefined;

    const agentDir = makeTempDir();
    const ctx = {
      cwd: makeTempDir(),
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
              overlayDone = resolvePromise;
              overlayComponent = factory(tui, mockTheme, {}, resolvePromise);
              tui.showOverlay(overlayComponent);
            }),
        ),
      },
    } as unknown as ExtensionContext;

    try {
      const settingsPromise = showTuiSettings(ctx, agentDir);
      await vi.waitFor(() => expect(overlayComponent).toBeDefined());
      if (!overlayComponent) throw new Error("TUI settings not mounted");
      assertRenderAcrossResizes(tui, terminal, overlayComponent);

      overlayDone?.(undefined);
      tui.hideOverlay();
      await settingsPromise;
    } finally {
      tui.stop();
    }
  });

  describe.runIf(process.env.PI_E2E === "1")("live SDK", () => {
    it("loads pi-modal and completes a prompt", async () => {
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
