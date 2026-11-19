import { mkdtempSync, rmSync } from "node:fs";
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

describe("pi-subagents E2E", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "pi-subagents-e2e-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    Reflect.deleteProperty(process.env, "PI_ACP");
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders and resizes subagent tool renderers and /subagent settings overlay in headless TUI", async () => {
    const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = makeTempDir();
    const cwd = makeTempDir();
    const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
    const commands = new Map<
      string,
      { handler: (args: string, ctx: unknown) => Promise<void> }
    >();
    const tools = new Map<
      string,
      {
        name: string;
        renderCall?: (
          args: unknown,
          theme: unknown,
          context: unknown,
        ) => Component;
        renderResult?: (
          result: unknown,
          options: { expanded: boolean; isPartial: boolean },
          theme: unknown,
          context: unknown,
        ) => Component;
      }
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
      registerTool: vi.fn(
        (tool: {
          name: string;
          renderCall?: (
            args: unknown,
            theme: unknown,
            context: unknown,
          ) => Component;
          renderResult?: (
            result: unknown,
            options: { expanded: boolean; isPartial: boolean },
            theme: unknown,
            context: unknown,
          ) => Component;
        }) => {
          tools.set(tool.name, tool);
        },
      ),
      appendEntry: vi.fn(),
      events: { emit: vi.fn(), on: vi.fn(() => () => {}) },
    };

    extension(pi as never);

    const subagentTool = tools.get("subagent");
    if (!subagentTool?.renderCall || !subagentTool.renderResult) {
      throw new Error("subagent tool or renderers not registered");
    }

    const terminal = new MemoryTerminal(140, 40);
    const tui = new TuiMainScreen(terminal);
    tui.start();

    let settingsComponent: Component | undefined;
    let settingsDone: ((value: unknown) => void) | undefined;

    const ctx = {
      cwd,
      mode: "tui",
      hasUI: true,
      sessionManager: {
        getBranch: () => [],
        getEntries: () => [],
        getSessionFile: () => undefined,
      },
      ui: {
        notify: vi.fn(),
        confirm: vi.fn(),
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
              settingsDone = resolve;
              settingsComponent = factory(tui, mockTheme, {}, resolve);
              tui.showOverlay(settingsComponent);
            }),
        ),
      },
    };

    try {
      for (const h of handlers.get("session_start") ?? []) {
        await h({ type: "session_start" }, ctx);
      }

      const callView = subagentTool.renderCall(
        {
          action: "spawn",
          agent: "scout",
          task: "Locate all extension entrypoints and summarize their UI registrations across narrow viewports",
        },
        mockTheme,
        {},
      );
      tui.addChild(callView);
      assertRenderAcrossWidths(tui, terminal, callView);
      tui.removeChild(callView);

      const resultView = subagentTool.renderResult(
        {
          content: [
            {
              type: "text",
              text: "Spawned subagent sub-e2e-1 (scout) — completed reconnaissance across 7 extensions.",
            },
          ],
          details: {
            id: "sub-e2e-1",
            agent: "scout",
            status: "completed",
            task: "Locate all extension entrypoints",
            summary: "Completed reconnaissance across 7 extensions.",
          },
        },
        { expanded: true, isPartial: false },
        mockTheme,
        {},
      );
      tui.addChild(resultView);
      assertRenderAcrossWidths(tui, terminal, resultView);
      tui.removeChild(resultView);

      const subagentCmd = commands.get("subagent");
      if (!subagentCmd) throw new Error("subagent command not registered");

      const settingsPromise = subagentCmd.handler("settings", ctx);
      await vi.waitFor(() => expect(settingsComponent).toBeDefined());
      if (!settingsComponent) throw new Error("settings component not mounted");
      assertRenderAcrossWidths(tui, terminal, settingsComponent);
      settingsDone?.(undefined);
      tui.hideOverlay();
      await settingsPromise;
    } finally {
      tui.stop();
      for (const h of handlers.get("session_shutdown") ?? []) {
        await h({ type: "session_shutdown" }, ctx);
      }
      if (prevAgentDir === undefined) {
        Reflect.deleteProperty(process.env, "PI_CODING_AGENT_DIR");
      } else {
        process.env.PI_CODING_AGENT_DIR = prevAgentDir;
      }
    }
  });

  describe.runIf(process.env.PI_E2E === "1")("live SDK", () => {
    it("loads pi-subagents and completes a prompt", async (t) => {
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
