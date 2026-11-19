import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  getAgentDir,
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

const EXT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../index.ts",
);
const WIDTHS = [120, 80, 44] as const;

class MemoryTerminal implements Terminal {
  columns: number;
  rows: number;
  readonly writes: string[] = [];
  private onResize?: () => void;

  constructor(columns = 120, rows = 40) {
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

function assertRenderAcrossWidths(
  tui: TuiMainScreen,
  terminal: MemoryTerminal,
  component: Component,
) {
  for (const width of WIDTHS) {
    terminal.writes.length = 0;
    terminal.resize(width, 40);
    tui.renderNow(false);
    expect(terminal.writes.length).toBeGreaterThan(0);

    const lines = component.render(width);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  }
}

describe("pi-agent E2E", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "pi-agent-e2e-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders and resizes the /agent fuzzy picker and settings overlays in headless TUI", async () => {
    const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = makeTempDir();
    const cwd = makeTempDir();
    const agentsDir = join(cwd, ".pi", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, "scout.md"),
      "---\nname: scout\ndescription: Fast codebase reconnaissance specialist with narrow-width wrapping\n---\nScout instructions.\n",
    );
    writeFileSync(
      join(agentsDir, "engineer.md"),
      "---\nname: engineer\ndescription: Implements verified changes cleanly\n---\nEngineer instructions.\n",
    );

    const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
    const commands = new Map<
      string,
      { handler: (args: string, ctx: unknown) => Promise<void> }
    >();

    const pi = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      }),
      registerCommand: vi.fn(
        (
          name: string,
          def: { handler: (args: string, ctx: unknown) => Promise<void> },
        ) => {
          commands.set(name, def);
        },
      ),
      appendEntry: vi.fn(),
      setActiveTools: vi.fn(),
      getActiveTools: vi.fn(() => ["read", "edit", "bash"]),
      getAllTools: vi.fn(() => [
        { name: "read", exposure: "direct" },
        { name: "edit", exposure: "direct" },
        { name: "bash", exposure: "direct" },
      ]),
      getSessionName: vi.fn(() => "e2e-session"),
      setSessionName: vi.fn(),
      setModel: vi.fn(async () => true),
      setThinkingLevel: vi.fn(),
      events: { emit: vi.fn(), on: vi.fn(() => () => {}) },
    };

    extension(pi as never);

    const terminal = new MemoryTerminal(140, 40);
    const tui = new TuiMainScreen(terminal);
    tui.start();

    const overlay: {
      component?: Component;
      done?: (value: unknown) => void;
    } = {};

    const ctx = {
      cwd,
      mode: "tui",
      hasUI: true,
      isProjectTrusted: () => true,
      sessionManager: {
        getBranch: () => [],
        getEntries: () => [],
      },
      modelRegistry: {
        getAll: () => [],
      },
      ui: {
        notify: vi.fn(),
        setStatus: vi.fn(),
        setTitle: vi.fn(),
        custom: vi.fn(
          (
            factory: (
              t: unknown,
              theme: unknown,
              kb: unknown,
              done: (value: unknown) => void,
            ) => Component,
          ) =>
            new Promise((resolve) => {
              overlay.done = resolve;
              overlay.component = factory(tui, mockTheme, {}, resolve);
              tui.showOverlay(overlay.component);
            }),
        ),
      },
    };

    try {
      for (const h of handlers.get("session_start") ?? []) {
        await h({ type: "session_start" }, ctx);
      }

      const agentCmd = commands.get("agent");
      if (!agentCmd) throw new Error("agent command not registered");

      const pickerPromise = agentCmd.handler("", ctx);
      await vi.waitFor(() => expect(overlay.component).toBeDefined());
      if (!overlay.component) throw new Error("picker component not mounted");
      assertRenderAcrossWidths(tui, terminal, overlay.component);
      overlay.done?.(undefined);
      tui.hideOverlay();
      await pickerPromise;

      const resetOverlay = () => {
        overlay.component = undefined;
        overlay.done = undefined;
      };
      resetOverlay();

      const settingsPromise = agentCmd.handler("settings", ctx);
      await vi.waitFor(() => expect(overlay.component).toBeDefined());
      if (!overlay.component) throw new Error("settings component not mounted");
      assertRenderAcrossWidths(tui, terminal, overlay.component);
      overlay.done?.(undefined);
      tui.hideOverlay();
      await settingsPromise;
    } finally {
      tui.stop();
      if (prevAgentDir === undefined) {
        Reflect.deleteProperty(process.env, "PI_CODING_AGENT_DIR");
      } else {
        process.env.PI_CODING_AGENT_DIR = prevAgentDir;
      }
    }
  });

  describe.runIf(process.env.PI_E2E === "1")("live SDK", () => {
    it("loads pi-agent and completes a prompt", async (t) => {
      const cwd = makeTempDir();
      const agentDir = getAgentDir();
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
          t.skip();
          return;
        }
        await session.setModel(model);
        await session.prompt("Reply with exactly: ok");
        expect(session.getLastAssistantText()?.trim().length).toBeGreaterThan(
          0,
        );
      } finally {
        session.dispose();
      }
    }, 60_000);
  });
});
