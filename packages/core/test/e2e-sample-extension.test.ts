import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  enterMode,
  evaluateDetailed,
  registerMode,
  resetSession,
} from "@hollowheap/core/modes";
import { checkPath } from "@hollowheap/core/policy";
import {
  DEFAULT_TUI_CONFIG,
  loadTuiConfig,
  updateTuiConfig,
} from "@hollowheap/core/tui-config";
import type { Rule } from "@hollowheap/core/types";
import { afterEach, describe, expect, it, vi } from "vitest";

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

function createSampleCoreExtension(agentDir: string): {
  factory: ExtensionFactory;
  owner: object;
} {
  const owner = {};
  const rules: Rule[] = [
    { tag: "read", pattern: "*", effect: "allow" },
    { tag: "edit", pattern: "src/**", effect: "ask" },
    { tag: "edit", pattern: ".env*", effect: "deny" },
  ];

  const factory: ExtensionFactory = (pi: ExtensionAPI) => {
    registerMode({
      name: "core-e2e-ask",
      source: "builtin",
      defaults: { edit: "ask", read: "allow" },
    });
    registerMode({
      name: "core-e2e-plan",
      source: "builtin",
      defaults: { edit: "deny", read: "allow" },
    });

    pi.on("session_start", (_event, ctx) => {
      enterMode(owner, "core-e2e-ask");
      const config = loadTuiConfig(agentDir);
      ctx.ui.setStatus(
        "core",
        `${config.borderStyle}:${config.overlaySurface}`,
      );
    });

    pi.registerCommand("core-status", {
      description: "Render policy, mode, and tui-config summary",
      handler: async (_args, ctx) => {
        const config = loadTuiConfig(agentDir);
        const editCheck = evaluateDetailed({
          owner,
          cwd: ctx.cwd,
          tag: "edit",
          target: join(ctx.cwd, "src/app.ts"),
          rules,
        });
        const envCheck = checkPath(
          rules,
          join(ctx.cwd, ".env.local"),
          "edit",
          ctx.cwd,
        );
        ctx.ui.notify(
          `${editCheck.verdict}|${envCheck}|${config.borderStyle}`,
          "info",
        );
      },
    });
  };

  return { factory, owner };
}

describe("packages/core sample extension E2E", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(`${tmpdir()}/pi-core-e2e-`);
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("evaluates policy, modes, and tui-config and renders across terminal resizes", async () => {
    const terminal = new MemoryTerminal(120, 30);
    const tui = new TuiMainScreen(terminal);
    tui.start();

    const cwd = makeTempDir();
    const agentDir = makeTempDir();
    const { factory, owner } = createSampleCoreExtension(agentDir);

    const commands = new Map<
      string,
      { handler: (args: string, ctx: ExtensionContext) => Promise<void> }
    >();
    const handlers = new Map<
      string,
      Array<(event: unknown, ctx: ExtensionContext) => Promise<void> | void>
    >();
    const notify = vi.fn();
    const setStatus = vi.fn();

    const pi = {
      on: vi.fn((event, fn) => {
        const list = handlers.get(event) ?? [];
        list.push(fn);
        handlers.set(event, list);
      }),
      registerCommand: vi.fn((name, def) => {
        commands.set(name, def);
      }),
    } as unknown as ExtensionAPI;

    const ctx = {
      cwd,
      hasUI: true,
      mode: "tui",
      ui: {
        notify,
        setStatus,
      },
    } as unknown as ExtensionContext;

    try {
      factory(pi);
      for (const fn of handlers.get("session_start") ?? []) {
        await fn({}, ctx);
      }
      expect(setStatus).toHaveBeenCalledWith(
        "core",
        `${DEFAULT_TUI_CONFIG.borderStyle}:${DEFAULT_TUI_CONFIG.overlaySurface}`,
      );

      const updated = updateTuiConfig(agentDir, (cfg) => ({
        ...cfg,
        borderStyle: "sharp",
        overlaySurface: "card",
      }));
      expect(updated.ok).toBe(true);

      await commands.get("core-status")?.handler("", ctx);
      expect(notify).toHaveBeenCalledWith("ask|deny|sharp", "info");

      enterMode(owner, "core-e2e-plan");
      const planResult = evaluateDetailed({
        owner,
        cwd,
        tag: "edit",
        target: join(cwd, "src/app.ts"),
        rules: [],
      });
      expect(planResult.verdict).toBe("deny");

      const statusComponent: Component = {
        invalidate: () => {},
        render: (width: number) => [
          truncateToWidth(
            `Mode: core-e2e-plan | Verdict: ${planResult.verdict} | Surface: card`,
            width,
            "",
          ),
          truncateToWidth(`Workspace: ${cwd}`, width, ""),
        ],
      };
      tui.addChild(statusComponent);
      assertRenderAcrossResizes(tui, terminal, statusComponent);
    } finally {
      resetSession(owner);
      tui.stop();
    }
  });

  describe.runIf(process.env.PI_E2E === "1")("live SDK", () => {
    it("loads sample core extension and completes a prompt", async () => {
      const cwd = makeTempDir();
      const agentDir = makeTempDir();
      const { factory, owner } = createSampleCoreExtension(agentDir);
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        noExtensions: true,
        extensionFactories: [factory],
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
        resetSession(owner);
        session.dispose();
      }
    }, 60_000);
  });
});
