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
  Text,
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

describe("pi-decide E2E", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "pi-decide-e2e-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("executes decide tool, runs lifecycle hooks, and renders output across terminal widths", async () => {
    const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
    const tools = new Map<
      string,
      {
        name: string;
        execute: (
          id: string,
          params: Record<string, unknown>,
          signal: AbortSignal | undefined,
          onUpdate: unknown,
          ctx: unknown,
        ) => Promise<{ content: Array<{ type: string; text?: string }> }>;
      }
    >();

    const pi = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      }),
      registerTool: vi.fn(
        (tool: {
          name: string;
          execute: (
            id: string,
            params: Record<string, unknown>,
            signal: AbortSignal | undefined,
            onUpdate: unknown,
            ctx: unknown,
          ) => Promise<{ content: Array<{ type: string; text?: string }> }>;
        }) => {
          tools.set(tool.name, tool);
        },
      ),
      appendEntry: vi.fn(),
      getAllTools: vi.fn(() => []),
      getActiveTools: vi.fn(() => []),
      setActiveTools: vi.fn(),
      events: { emit: vi.fn(), on: vi.fn(() => () => {}) },
    };

    extension(pi as never);

    const ctx = {
      cwd: makeTempDir(),
      hasUI: true,
      sessionManager: {
        getBranch: () => [],
        getEntries: () => [],
      },
      modelRegistry: {
        find: () => undefined,
        complete: vi.fn(),
      },
      ui: {
        notify: vi.fn(),
      },
    };

    for (const h of handlers.get("session_start") ?? []) {
      await h({ type: "session_start" }, ctx);
    }

    const decideTool = tools.get("decide");
    if (!decideTool) throw new Error("decide tool not registered");

    const result = await decideTool.execute(
      "call-1",
      {
        kind: "bool",
        input:
          "All unit tests passed and typecheck succeeded with zero warnings.",
        question: "Is this ready for review?",
      },
      undefined,
      undefined,
      ctx,
    );

    const renderedText = result.content
      .map((item) => item.text ?? "")
      .join("\n")
      .trim();
    expect(renderedText.length).toBeGreaterThan(0);

    for (const h of handlers.get("agent_end") ?? []) {
      await h({ type: "agent_end", messages: [] }, ctx);
    }

    const terminal = new MemoryTerminal(140, 40);
    const tui = new TuiMainScreen(terminal);
    const view = new Text(renderedText, 1, 0);
    tui.addChild(view);
    tui.start();
    try {
      assertRenderAcrossWidths(tui, terminal, view);
    } finally {
      tui.stop();
    }
  });

  describe.runIf(process.env.PI_E2E === "1")("live SDK", () => {
    it("loads pi-decide and completes a prompt", async (t) => {
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
