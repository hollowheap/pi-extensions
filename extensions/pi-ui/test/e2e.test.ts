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
  TuiMainScreen,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showTabbedSettingsDialog } from "../src/settings.js";
import { showCodeViewer } from "../src/viewer.js";

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

describe("pi-ui E2E", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(`${tmpdir()}/pi-ui-e2e-`);
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders showTabbedSettingsDialog and showCodeViewer across terminal resizes", async () => {
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
              const component = factory(tui, mockTheme, {}, resolvePromise);
              pending = { component, done: resolvePromise };
              tui.showOverlay(component);
            }),
        ),
      },
    } as unknown as ExtensionContext;

    try {
      const settingsPromise = showTabbedSettingsDialog({
        ctx,
        title: "UI Settings",
        listHeight: 6,
        frameOptions: () => ({
          borderStyle: "rounded",
          overlaySurface: "surface",
        }),
        tabs: [
          {
            label: "General",
            items: [
              {
                id: "mode",
                label: "Surface mode",
                currentValue: "surface",
                values: ["transparent", "surface", "card"],
              },
              {
                id: "border",
                label: "Border style",
                currentValue: "rounded",
                values: ["rounded", "sharp", "none"],
              },
            ],
          },
          {
            label: "Advanced",
            items: [
              {
                id: "pad",
                label: "Output padding",
                currentValue: "1",
                values: ["0", "1"],
              },
            ],
          },
        ],
        onChange: () => {},
      });

      const settingsMount = await waitMount();
      assertRenderAcrossResizes(tui, terminal, settingsMount.component);
      settingsMount.component.handleInput?.("\t");
      assertRenderAcrossResizes(tui, terminal, settingsMount.component);

      settingsMount.done(undefined);
      tui.hideOverlay();
      await settingsPromise;

      const sampleCode = [
        "export function resizeCheck(width: number): string {",
        "  const label = 'Long line of TypeScript code to test horizontal clipping across 120/80/48/30';",
        "  return `${label}:${width}`;",
        "}",
      ].join("\n");

      const viewerPromise = showCodeViewer(ctx, "viewer.ts", sampleCode);
      const viewerMount = await waitMount();
      assertRenderAcrossResizes(tui, terminal, viewerMount.component);

      viewerMount.done(undefined);
      tui.hideOverlay();
      await viewerPromise;
    } finally {
      tui.stop();
    }
  });

  describe.runIf(process.env.PI_E2E === "1")("live SDK", () => {
    it("loads a sample extension using pi-ui and completes a prompt", async () => {
      const cwd = makeTempDir();
      const agentDir = makeTempDir();
      const sampleExtension: ExtensionFactory = (pi: ExtensionAPI) => {
        pi.registerCommand("ui-demo", {
          description: "Open sample code viewer",
          handler: async (_args, cmdCtx) => {
            await showCodeViewer(cmdCtx, "demo.ts", "const ok = true;");
          },
        });
      };

      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        noExtensions: true,
        extensionFactories: [sampleExtension],
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
