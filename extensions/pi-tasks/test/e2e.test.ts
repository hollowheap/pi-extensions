import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DefaultResourceLoader,
  type ExtensionAPI,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  createAgentSession,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  KeybindingsManager,
  type Terminal,
  TuiMainScreen,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ agentDir: "" }));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    getAgentDir: () => state.agentDir || actual.getAgentDir(),
  };
});

import tasksExtension from "../src/index.js";

class MemoryTerminal implements Terminal {
  columns: number;
  rows: number;
  writes: string[] = [];
  private onResize?: () => void;

  constructor(columns = 120, rows = 30) {
    this.columns = columns;
    this.rows = rows;
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

  get kittyProtocolActive(): boolean {
    return false;
  }

  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
  setProgramStatus(): void {}

  resize(columns: number, rows = this.rows): void {
    this.columns = columns;
    this.rows = rows;
    this.onResize?.();
  }
}

const tempDirs: string[] = [];

afterEach(() => {
  state.agentDir = "";
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("extensions/pi-tasks E2E", () => {
  it("runs a task and renders /task picker overlay across 120 -> 80 -> 44 resizes", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-tasks-e2e-"));
    tempDirs.push(root);
    state.agentDir = join(root, "agent");
    mkdirSync(state.agentDir, { recursive: true });

    const tools = new Map<
      string,
      { execute: (...args: never[]) => Promise<unknown> }
    >();
    const commands = new Map<
      string,
      (args: string, ctx: never) => Promise<void>
    >();
    const handlers = new Map<
      string,
      (event: never, ctx: never) => Promise<unknown>
    >();

    const mockPi = {
      on: (
        event: string,
        fn: (event: never, ctx: never) => Promise<unknown>,
      ) => {
        handlers.set(event, fn);
      },
      registerTool: (def: {
        name: string;
        execute: (...args: never[]) => Promise<unknown>;
      }) => {
        tools.set(def.name, def);
      },
      registerCommand: (
        name: string,
        def: { handler: (args: string, ctx: never) => Promise<void> },
      ) => {
        commands.set(name, def.handler);
      },
      registerShortcut: vi.fn(),
      events: {
        emit: vi.fn(),
        on: vi.fn(() => () => {}),
      },
    };

    tasksExtension(mockPi as unknown as ExtensionAPI);

    const terminal = new MemoryTerminal(140, 30);
    const tui = new TuiMainScreen(terminal);
    const theme = {
      fg: (_token: string, text: string) => text,
      bold: (text: string) => text,
    };

    const ctx = {
      cwd: root,
      sessionManager: {},
      hasUI: true,
      mode: "rpc",
      isProjectTrusted: () => true,
      ui: {
        notify: vi.fn(),
        setStatus: vi.fn(),
        confirm: vi.fn(async () => true),
        custom: vi.fn(
          async (
            factory: (
              tuiArg: TuiMainScreen,
              themeArg: typeof theme,
              kb: KeybindingsManager,
              done: (value: unknown) => void,
            ) => Component,
          ) => {
            let resolved: unknown;
            const component = factory(
              tui,
              theme,
              new KeybindingsManager({}),
              (value) => {
                resolved = value;
              },
            );
            tui.start();
            try {
              tui.addChild(component);
              for (const width of [120, 80, 44]) {
                terminal.writes = [];
                terminal.resize(width, 30);
                tui.renderNow(false);
                expect(terminal.writes.length).toBeGreaterThan(0);

                const lines = tui.render(width);
                expect(lines.length).toBeGreaterThan(0);
                for (const line of lines) {
                  expect(visibleWidth(line)).toBeLessThanOrEqual(width);
                }
              }
            } finally {
              tui.removeChild(component);
              tui.stop();
            }
            return resolved;
          },
        ),
      },
    };

    const taskTool = tools.get("task");
    expect(taskTool).toBeDefined();

    try {
      const startRes = (await taskTool?.execute(
        "t-1" as never,
        { action: "start", command: "echo pi-tasks-e2e-ok" } as never,
        undefined as never,
        undefined as never,
        ctx as never,
      )) as { content?: Array<{ text?: string }>; details?: { id?: string } };
      const taskId = startRes?.details?.id;
      expect(taskId, JSON.stringify(startRes)).toBeTruthy();

      await taskTool?.execute(
        "t-2" as never,
        { action: "wait", id: taskId, timeoutMs: 5_000 } as never,
        undefined as never,
        undefined as never,
        ctx as never,
      );

      ctx.mode = "tui";
      const taskCmd = commands.get("task");
      expect(taskCmd).toBeDefined();
      await taskCmd?.("", ctx as never);
      expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
    } finally {
      await handlers.get("session_shutdown")?.({} as never, ctx as never);
    }
  });

  describe.runIf(process.env.PI_E2E === "1")("live SDK E2E", () => {
    it("loads pi-tasks extension and completes a prompt", async (t) => {
      const root = mkdtempSync(join(tmpdir(), "pi-tasks-sdk-"));
      tempDirs.push(root);
      const agentDir = getAgentDir();
      const modelRuntime = await ModelRuntime.create({
        authPath: join(agentDir, "auth.json"),
        modelsPath: join(agentDir, "models.json"),
      });
      const modelRegistry = new ModelRegistry(modelRuntime);
      const provider = process.env.PI_E2E_PROVIDER ?? "opencode-go";
      const modelId = process.env.PI_E2E_MODEL ?? "hy4-flash-free";
      const model = modelRegistry.find(provider, modelId);
      if (!model || !modelRegistry.hasConfiguredAuth(model)) {
        t.skip();
        return;
      }

      const extDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
      const loader = new DefaultResourceLoader({
        cwd: root,
        agentDir,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        additionalExtensionPaths: [extDir],
      });
      await loader.reload();

      const { session } = await createAgentSession({
        cwd: root,
        agentDir,
        model,
        modelRuntime,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(),
        noTools: "all",
      });

      try {
        await session.prompt("Reply with exactly: OK");
        expect(session.getLastAssistantText()?.trim().length).toBeGreaterThan(
          0,
        );
      } finally {
        session.dispose();
      }
    }, 60_000);
  });
});
