import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  createAgentSession,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  Box,
  type Component,
  type Terminal,
  Text,
  TuiMainScreen,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { type CaptureResult, runCapture } from "../src/index.js";

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

interface RuntimeRunRecord {
  script: string;
  result: CaptureResult;
}

function createSampleRuntimeExtension(
  runs: RuntimeRunRecord[],
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "run_runtime_cmd",
      label: "Run Runtime Script",
      description: "Execute a short Node.js script via @hollowheap/runtime",
      parameters: Type.Object({
        script: Type.String({ minLength: 1 }),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const result = await runCapture(
          process.execPath,
          ["-e", params.script],
          ctx.cwd,
          signal,
          { timeoutMs: 5_000 },
        );
        runs.push({ script: params.script, result });
        return {
          content: [
            {
              type: "text",
              text: `code=${result.code} stdout=${result.stdout.trim()}`,
            },
          ],
          details: result,
        };
      },
    });

    pi.registerMessageRenderer<CaptureResult>("runtime-result", (message) => {
      const details = message.details;
      const summary = details
        ? `[runtime] code=${details.code} out=${details.stdout.trim()}`
        : String(message.content);
      const box = new Box(1, 0);
      box.addChild(new Text(summary, 0, 0));
      return {
        render: (width: number) =>
          box.render(width).map((row) => truncateToWidth(row, width)),
        invalidate: () => box.invalidate(),
      };
    });

    pi.registerCommand("runtime-status", {
      description: "Show recent runtime subprocess runs",
      handler: async (_args, ctx) => {
        ctx.ui.setWidget(
          "runtime-runs",
          (): Component => ({
            render: (width: number) => {
              const header = truncateToWidth(
                `Runtime Executions (${runs.length})`,
                width,
              );
              const lines = runs.map((entry) =>
                truncateToWidth(
                  `• code=${entry.result.code} ${entry.result.stdout.trim() || "(empty)"}`,
                  width,
                ),
              );
              return [header, ...lines];
            },
            invalidate: () => {},
          }),
        );
      },
    });
  };
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("packages/runtime sample extension E2E", () => {
  it("runs subprocess via runCapture and renders widget & message across 120 -> 80 -> 44 resizes", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-runtime-e2e-"));
    tempDirs.push(root);

    const runs: RuntimeRunRecord[] = [];
    const tools = new Map<
      string,
      {
        execute: (
          id: string,
          params: { script: string },
          signal: AbortSignal | undefined,
          onUpdate: unknown,
          ctx: { cwd: string },
        ) => Promise<{
          content: Array<{ type: string; text: string }>;
          details: CaptureResult;
        }>;
      }
    >();
    const commands = new Map<
      string,
      (args: string, ctx: never) => Promise<void>
    >();
    const renderers = new Map<
      string,
      (message: {
        customType: string;
        content: string;
        details?: CaptureResult;
      }) => Component | undefined
    >();
    const widgets = new Map<string, () => Component>();

    const mockPi = {
      registerTool: (def: { name: string; execute: never }) => {
        tools.set(def.name, def as never);
      },
      registerCommand: (
        name: string,
        def: { handler: (args: string, ctx: never) => Promise<void> },
      ) => {
        commands.set(name, def.handler);
      },
      registerMessageRenderer: (
        type: string,
        renderer: (message: {
          customType: string;
          content: string;
          details?: CaptureResult;
        }) => Component | undefined,
      ) => {
        renderers.set(type, renderer);
      },
    };

    createSampleRuntimeExtension(runs)(mockPi as unknown as ExtensionAPI);

    const tool = tools.get("run_runtime_cmd");
    expect(tool).toBeDefined();

    const execResult = await tool?.execute(
      "call-1",
      { script: "console.log('runtime-hello-world-from-subprocess')" },
      undefined,
      undefined,
      { cwd: root },
    );
    expect(execResult?.details.code).toBe(0);
    expect(execResult?.details.stdout.trim()).toBe(
      "runtime-hello-world-from-subprocess",
    );

    const ctx = {
      cwd: root,
      ui: {
        setWidget: (id: string, factoryFn: () => Component) => {
          widgets.set(id, factoryFn);
        },
      },
    };

    const cmd = commands.get("runtime-status");
    await cmd?.("", ctx as never);

    const widget = widgets.get("runtime-runs")?.();
    expect(widget).toBeDefined();

    const msgComponent = renderers.get("runtime-result")?.({
      customType: "runtime-result",
      content: "runtime",
      details: execResult?.details,
    });
    expect(msgComponent).toBeDefined();

    const terminal = new MemoryTerminal(120, 30);
    const tui = new TuiMainScreen(terminal);
    tui.start();
    try {
      if (widget) tui.addChild(widget);
      if (msgComponent) tui.addChild(msgComponent);

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
    it("loads sample runtime extension and completes a prompt", async () => {
      const root = mkdtempSync(join(tmpdir(), "pi-runtime-sdk-"));
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

      const runs: RuntimeRunRecord[] = [];
      const loader = new DefaultResourceLoader({
        cwd: root,
        agentDir,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        extensionFactories: [createSampleRuntimeExtension(runs)],
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
