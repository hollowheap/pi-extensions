import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DefaultResourceLoader,
  type ExtensionContext,
  ModelRegistry,
  SessionManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type ProgramStatus,
  type Terminal,
  TuiMainScreen,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { askQuestion, askQuestions } from "../src/dialogs.js";

const EXT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../index.ts",
);
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

const mockTheme = {
  fg: (_token: string, text: string) => text,
  bg: (_token: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
  underline: (text: string) => text,
  strikethrough: (text: string) => text,
};

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

describe("pi-question E2E", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = mkdtempSync(`${tmpdir()}/pi-question-e2e-`);
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders single, multi-select, and tabbed review dialogs across terminal resizes", async () => {
    const terminal = new MemoryTerminal(120, 30);
    const tui = new TuiMainScreen(terminal);
    tui.start();

    let pending:
      | { component: Component; done: (value: unknown) => void }
      | undefined;
    const waitMount = async () => {
      await vi.waitFor(() => expect(pending).toBeDefined());
      const current = pending;
      pending = undefined;
      if (!current) throw new Error("dialog not mounted");
      return current;
    };
    const customCalls: Array<{ overlay?: boolean }> = [];

    const ctx = {
      cwd: makeTempDir(),
      hasUI: true,
      mode: "tui",
      ui: {
        theme: mockTheme,
        notify: vi.fn(),
        custom: vi.fn(
          (
            factory: (
              t: unknown,
              theme: unknown,
              kb: unknown,
              done: (value: unknown) => void,
            ) => Component,
            options?: { overlay?: boolean },
          ) => {
            customCalls.push(options ?? {});
            return new Promise((resolvePromise) => {
              const component = factory(tui, mockTheme, {}, resolvePromise);
              pending = { component, done: resolvePromise };
              tui.addChild(component);
            });
          },
        ),
      },
    } as unknown as ExtensionContext;

    try {
      const singlePromise = askQuestion(
        {
          prompt: "Choose target deployment environment for release",
          mode: "single",
          options: ["production", "staging", "local-dev"],
        },
        ctx,
      );
      const singleMount = await waitMount();
      expect(customCalls.at(-1)?.overlay).toBe(false);
      assertRenderAcrossResizes(tui, terminal, singleMount.component);
      singleMount.done(undefined);
      tui.removeChild(singleMount.component);
      await singlePromise;

      const multiPromise = askQuestion(
        {
          prompt: "Select features to enable in this workspace",
          mode: "multi",
          options: ["linting", "typechecking", "e2e-tests"],
        },
        ctx,
      );
      const multiMount = await waitMount();
      expect(customCalls.at(-1)?.overlay).toBe(false);
      assertRenderAcrossResizes(tui, terminal, multiMount.component);
      multiMount.done(undefined);
      tui.removeChild(multiMount.component);
      await multiPromise;

      const flowPromise = askQuestions(
        [
          {
            prompt: "Preferred package manager",
            mode: "single",
            options: ["npm", "pnpm"],
          },
          {
            prompt: "Additional checks",
            mode: "multi",
            options: ["biome", "vitest"],
          },
        ],
        ctx,
      );
      const flowMount = await waitMount();
      expect(customCalls.at(-1)?.overlay).toBe(false);
      assertRenderAcrossResizes(tui, terminal, flowMount.component);
      flowMount.component.handleInput?.("\t");
      assertRenderAcrossResizes(tui, terminal, flowMount.component);
      flowMount.done(undefined);
      tui.removeChild(flowMount.component);
      await flowPromise;
    } finally {
      tui.stop();
    }
  });

  describe.runIf(process.env.PI_E2E === "1")("live SDK", () => {
    it("loads pi-question and completes a prompt", async () => {
      const cwd = makeTempDir();
      const agentDir = makeTempDir();
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
          return;
        }
        await session.setModel(model);
        await session.prompt("Reply with exactly: ok");
        expect(session.messages.length).toBeGreaterThan(0);
      } finally {
        session.dispose();
      }
    }, 60_000);
  });
});
