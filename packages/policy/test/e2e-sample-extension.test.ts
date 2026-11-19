import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { registerMode } from "@hollowheap/core/modes";
import { readPersistedMode } from "@hollowheap/core/state";
import { afterEach, describe, expect, it } from "vitest";
import policyExtension from "../src/extension.js";
import { BUILTIN_MODE_LAYERS, readToolTarget } from "../src/index.js";

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

interface PolicyDecisionRecord {
  toolName: string;
  target: string;
  verdict: "allow" | "deny";
  reason?: string;
}

function createSamplePolicyExtension(
  records: PolicyDecisionRecord[],
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    for (const layer of BUILTIN_MODE_LAYERS) {
      registerMode(layer);
    }

    let policyToolCallHandler:
      | ((event: never, ctx: never) => Promise<unknown>)
      | undefined;
    const innerPi = {
      on: (
        event: string,
        fn: (event: never, ctx: never) => Promise<unknown>,
      ) => {
        if (event === "tool_call") {
          policyToolCallHandler = fn;
        }
      },
    };
    policyExtension(innerPi as unknown as ExtensionAPI);

    pi.on("tool_call", async (event, ctx) => {
      const outcome = (await policyToolCallHandler?.(
        event as never,
        ctx as never,
      )) as { block?: boolean; reason?: string } | undefined;
      const rawTarget = readToolTarget(event.toolName, event.input);
      records.push({
        toolName: event.toolName,
        target: rawTarget ?? "(none)",
        verdict: outcome?.block ? "deny" : "allow",
        reason: outcome?.reason,
      });
      return outcome?.block
        ? { block: true, reason: outcome.reason }
        : undefined;
    });

    pi.registerMessageRenderer<PolicyDecisionRecord>(
      "policy-decision",
      (message) => {
        const details = message.details;
        const line = details
          ? `[policy:${details.verdict}] ${details.toolName} -> ${details.target}${details.reason ? ` (${details.reason})` : ""}`
          : String(message.content);
        const box = new Box(1, 0);
        box.addChild(new Text(line, 0, 0));
        return {
          render: (width: number) =>
            box.render(width).map((row) => truncateToWidth(row, width)),
          invalidate: () => box.invalidate(),
        };
      },
    );

    pi.registerCommand("policy-status", {
      description: "Render current policy decisions",
      handler: async (_args, ctx) => {
        ctx.ui.setWidget(
          "policy-audit",
          (): Component => ({
            render: (width: number) => {
              const header = truncateToWidth(
                `Policy Mode: ${readPersistedMode(ctx.sessionManager) ?? "auto"} (${records.length} checks)`,
                width,
              );
              const rows = records.map((entry) =>
                truncateToWidth(
                  `• ${entry.verdict.toUpperCase()} ${entry.toolName}: ${entry.target}`,
                  width,
                ),
              );
              return [header, ...rows];
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

describe("packages/policy sample extension E2E", () => {
  it("gates tool calls and renders policy widget & message across 120 -> 80 -> 44 resizes", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-policy-e2e-"));
    tempDirs.push(root);
    mkdirSync(join(root, ".pi"), { recursive: true });
    writeFileSync(
      join(root, ".pi", "permissions.json"),
      JSON.stringify({
        rules: [
          {
            tool: "write",
            path: "keys/**",
            effect: "deny",
          },
        ],
      }),
    );

    const records: PolicyDecisionRecord[] = [];
    const handlers = new Map<
      string,
      (event: never, ctx: never) => Promise<unknown>
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
        details?: PolicyDecisionRecord;
      }) => Component | undefined
    >();
    const widgets = new Map<string, () => Component>();

    const mockPi = {
      on: (
        event: string,
        fn: (event: never, ctx: never) => Promise<unknown>,
      ) => {
        handlers.set(event, fn);
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
          details?: PolicyDecisionRecord;
        }) => Component | undefined,
      ) => {
        renderers.set(type, renderer);
      },
    };

    const factory = createSamplePolicyExtension(records);
    factory(mockPi as unknown as ExtensionAPI);

    const ctx = {
      cwd: root,
      sessionManager: {},
      hasUI: false,
      isProjectTrusted: () => true,
      ui: {
        setWidget: (
          id: string,
          factoryFn: (_tui: unknown, _theme: unknown) => Component,
        ) => {
          widgets.set(id, () => factoryFn(undefined, undefined));
        },
      },
    };

    const toolCall = handlers.get("tool_call");
    expect(toolCall).toBeDefined();

    const readResult = await toolCall?.(
      {
        type: "tool_call",
        toolCallId: "1",
        toolName: "read",
        input: { path: "src/app.ts" },
      } as never,
      ctx as never,
    );
    expect(readResult).toBeUndefined();

    const writeResult = await toolCall?.(
      {
        type: "tool_call",
        toolCallId: "2",
        toolName: "write",
        input: { path: "keys/api.secret" },
      } as never,
      ctx as never,
    );
    expect(writeResult).toMatchObject({ block: true });

    const cmd = commands.get("policy-status");
    expect(cmd).toBeDefined();
    await cmd?.("", ctx as never);

    const widgetFactory = widgets.get("policy-audit");
    expect(widgetFactory).toBeDefined();
    const widget = widgetFactory?.();
    expect(widget).toBeDefined();

    const renderer = renderers.get("policy-decision");
    const msgComponent = renderer?.({
      customType: "policy-decision",
      content: "policy",
      details: records[1],
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
    it("loads sample policy extension and completes a prompt", async () => {
      const root = mkdtempSync(join(tmpdir(), "pi-policy-sdk-"));
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

      const records: PolicyDecisionRecord[] = [];
      const loader = new DefaultResourceLoader({
        cwd: root,
        agentDir,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        extensionFactories: [createSamplePolicyExtension(records)],
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
