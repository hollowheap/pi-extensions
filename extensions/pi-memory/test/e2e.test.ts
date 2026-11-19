import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { MEMORY_OBSERVATION_TYPE } from "../src/ledger.js";

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

describe("pi-memory E2E", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "pi-memory-e2e-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders and resizes the /memory view session pager in headless TUI", async () => {
    const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    const tempAgentDir = makeTempDir();
    writeFileSync(
      join(tempAgentDir, "memory.json"),
      JSON.stringify({ enabled: true, model: "opencode-go/hy4-flash-free" }),
    );
    process.env.PI_CODING_AGENT_DIR = tempAgentDir;
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
      events: { emit: vi.fn(), on: vi.fn(() => () => {}) },
    };

    extension(pi as never);

    const terminal = new MemoryTerminal(140, 40);
    const tui = new TuiMainScreen(terminal);
    tui.start();

    let pagerComponent: Component | undefined;
    let pagerDone: ((value: unknown) => void) | undefined;

    const branch = [
      {
        type: "custom",
        customType: MEMORY_OBSERVATION_TYPE,
        data: {
          id: "obs-1",
          text: "Prefer running narrow vitest slices before full workspace checks; keep commits GPG-signed.",
          relevance: 5,
          createdAt: Date.now(),
          sourceEntryIds: ["m1"],
        },
      },
    ];

    const ctx = {
      cwd,
      mode: "tui",
      hasUI: true,
      sessionManager: {
        getBranch: () => branch,
        getEntries: () => branch,
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
              pagerDone = resolve;
              pagerComponent = factory(tui, mockTheme, {}, resolve);
              tui.showOverlay(pagerComponent);
            }),
        ),
      },
    };

    try {
      for (const h of handlers.get("session_start") ?? []) {
        await h({ type: "session_start" }, ctx);
      }

      const searchTool = tools.get("recall");
      if (!searchTool) throw new Error("recall tool not registered");
      const searchResult = await searchTool.execute(
        "call-1",
        { query: "vitest" },
        undefined,
        undefined,
        ctx,
      );
      expect(
        searchResult.content.map((c) => c.text ?? "").join("\n"),
      ).toContain("vitest");

      const memoryCmd = commands.get("memory");
      if (!memoryCmd) throw new Error("memory command not registered");

      const viewPromise = memoryCmd.handler("view session", ctx);
      await vi.waitFor(() => expect(pagerComponent).toBeDefined());
      if (!pagerComponent) throw new Error("pager component not mounted");
      assertRenderAcrossWidths(tui, terminal, pagerComponent);
      pagerDone?.(undefined);
      tui.hideOverlay();
      await viewPromise;
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
    it("loads pi-memory and completes a prompt", async (t) => {
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
