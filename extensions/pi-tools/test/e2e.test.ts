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
  Box,
  type Terminal,
  Text,
  TuiMainScreen,
  truncateToWidth,
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

import toolsExtension from "../src/index.js";

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

describe("extensions/pi-tools E2E", () => {
  it("executes /cd and compact_context and renders command/status output across 120 -> 80 -> 44 resizes", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-tools-e2e-"));
    tempDirs.push(root);
    state.agentDir = join(root, "agent");
    mkdirSync(state.agentDir, { recursive: true });
    const subDir = join(root, "nested-workspace-directory");
    mkdirSync(subDir, { recursive: true });

    const tools = new Map<
      string,
      {
        execute: (
          ...args: never[]
        ) => Promise<{ content: Array<{ type: string; text: string }> }>;
      }
    >();
    const commands = new Map<
      string,
      (args: string, ctx: never) => Promise<void>
    >();
    const notifications: string[] = [];
    const statuses: string[] = [];

    const mockPi = {
      on: vi.fn(),
      registerTool: (def: {
        name: string;
        execute: (
          ...args: never[]
        ) => Promise<{ content: Array<{ type: string; text: string }> }>;
      }) => {
        tools.set(def.name, def);
      },
      registerCommand: (
        name: string,
        def: { handler: (args: string, ctx: never) => Promise<void> },
      ) => {
        commands.set(name, def.handler);
      },
    };

    toolsExtension(mockPi as unknown as ExtensionAPI);

    const ctx = {
      cwd: root,
      sessionManager: {
        getBranch: () => [],
        appendCustomEntry: vi.fn(),
      },
      hasUI: true,
      isProjectTrusted: () => true,
      compact: vi.fn(),
      ui: {
        notify: (msg: string) => notifications.push(msg),
        setStatus: (id: string, text: string | undefined) => {
          if (text) statuses.push(`${id}: ${text}`);
        },
        confirm: vi.fn(async () => true),
      },
    };

    const cdCmd = commands.get("cd");
    expect(cdCmd).toBeDefined();
    await cdCmd?.(subDir, ctx as never);
    expect(notifications.length + statuses.length).toBeGreaterThan(0);

    const compactTool = tools.get("compact_context");
    expect(compactTool).toBeDefined();
    const compactRes = await compactTool?.execute(
      "compact-1" as never,
      { instructions: "Keep E2E test summary" } as never,
      undefined as never,
      undefined as never,
      ctx as never,
    );
    const toolText = compactRes?.content.map((c) => c.text).join(" ") ?? "";

    const terminal = new MemoryTerminal(120, 30);
    const tui = new TuiMainScreen(terminal);
    const box = new Box(1, 0);
    for (const line of [...statuses, ...notifications, toolText]) {
      box.addChild(new Text(line, 0, 0));
    }
    const clamped = {
      render: (width: number) =>
        box.render(width).map((row) => truncateToWidth(row, width)),
      invalidate: () => box.invalidate(),
    };

    tui.start();
    try {
      tui.addChild(clamped);
      for (const width of [120, 80, 44]) {
        terminal.writes = [];
        terminal.resize(width, 30);
        tui.renderNow(true);
        expect(terminal.writes.length).toBeGreaterThan(0);

        const lines = tui.render(width);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        }
      }
    } finally {
      tui.stop();
    }
  });

  describe.runIf(process.env.PI_E2E === "1")("live SDK E2E", () => {
    it("loads pi-tools extension and completes a prompt", async () => {
      const root = mkdtempSync(join(tmpdir(), "pi-tools-sdk-"));
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
      expect(model).toBeDefined();

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
        expect(session.state.messages.length).toBeGreaterThan(0);
      } finally {
        session.dispose();
      }
    }, 60_000);
  });
});
