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

describe("pi-language-tools E2E", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "pi-lang-e2e-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders and resizes collapsed and expanded lang tool results in headless TUI", async () => {
    const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
    const tools = new Map<
      string,
      {
        name: string;
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
      registerTool: vi.fn(
        (tool: {
          name: string;
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
      events: { emit: vi.fn(), on: vi.fn(() => () => {}) },
    };

    extension(pi as never);

    const langTool = tools.get("lang");
    if (!langTool?.renderResult) {
      throw new Error("lang tool or renderResult not registered");
    }

    const sampleResult = {
      content: [
        {
          type: "text",
          text: [
            "### Hover: `createAgentSession`",
            "",
            "```ts",
            "function createAgentSession(options?: CreateAgentSessionOptions): Promise<CreateAgentSessionResult>",
            "```",
            "",
            "- src/core/sdk.ts:116:1",
            "- src/core/agent-session.ts:42:10",
            "- line 9",
            "- line 10",
            "- line 11",
          ].join("\n"),
        },
      ],
      details: {},
    };

    const terminal = new MemoryTerminal(140, 40);
    const tui = new TuiMainScreen(terminal);
    tui.start();

    try {
      const collapsed = langTool.renderResult(
        sampleResult,
        { expanded: false, isPartial: false },
        mockTheme,
        {},
      );
      tui.addChild(collapsed);
      assertRenderAcrossWidths(tui, terminal, collapsed);
      tui.removeChild(collapsed);

      const expanded = langTool.renderResult(
        sampleResult,
        { expanded: true, isPartial: false },
        mockTheme,
        {},
      );
      tui.addChild(expanded);
      assertRenderAcrossWidths(tui, terminal, expanded);
      tui.removeChild(expanded);
    } finally {
      tui.stop();
    }
  });

  describe.runIf(process.env.PI_E2E === "1")("live SDK", () => {
    it("loads pi-language-tools and completes a prompt", async (t) => {
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
