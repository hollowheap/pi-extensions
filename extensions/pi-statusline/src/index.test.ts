import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setCwd } from "@hollowheap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension from "./index.js";

const state = vi.hoisted(() => ({
  agentDir: "/nonexistent-pi-agent-dir-for-tests",
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => state.agentDir,
}));

afterEach(() => {
  state.agentDir = "/nonexistent-pi-agent-dir-for-tests";
});

function createMockPi() {
  return {
    on: vi.fn(
      (_event: string, _fn: (event: never, ctx: never) => void) => () => {},
    ),
    registerCommand: vi.fn(),
    exec: vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "",
      code: 1,
      killed: false,
    }),
    sendUserMessage: vi.fn(),
    events: {
      on: vi.fn((_channel: string, _fn: (data: unknown) => void) => () => {}),
      emit: vi.fn((_channel: string, _data: unknown) => {}),
    },
  };
}

function handlers(
  pi: ReturnType<typeof createMockPi>,
): Record<string, (event: never, ctx: never) => void> {
  return Object.fromEntries(pi.on.mock.calls.map(([event, fn]) => [event, fn]));
}

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    mode: "tui",
    hasUI: true,
    cwd: "/home/u/app",
    model: { id: "anthropic/claude-opus-4-6" },
    sessionManager: { getBranch: () => [] },
    getContextUsage: () => ({
      tokens: 1000,
      contextWindow: 200000,
      percent: 0.5,
    }),
    ui: {
      setFooter: vi.fn(),
      notify: vi.fn(),
      setStatus: vi.fn(),
      setWorkingIndicator: vi.fn(),
      setHiddenThinkingLabel: vi.fn(),
    },
    ...overrides,
  };
}

function installFooter(
  pi: ReturnType<typeof createMockPi>,
  ctx: ReturnType<typeof createMockCtx>,
) {
  handlers(pi).session_start(undefined as never, ctx as never);
  expect(ctx.ui.setFooter).toHaveBeenCalledTimes(1);
  const factory = ctx.ui.setFooter.mock.calls[0][0];
  const tui = { requestRender: vi.fn() };
  const footerData = {
    getGitBranch: () => "main",
    onBranchChange: vi.fn(() => () => {}),
  };
  return { component: factory(tui, {}, footerData), tui };
}

function publish(
  pi: ReturnType<typeof createMockPi>,
  name: string,
  text: string,
) {
  const entry = pi.events.on.mock.calls.find(
    ([channel]) => channel === "statusline:values",
  );
  if (entry === undefined)
    throw new Error("missing statusline:values subscription");
  entry[1]({ name, text });
}

describe("pi-statusline extension", () => {
  it("renders the effective cwd from the core session", () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createMockCtx();
    setCwd(ctx.sessionManager, "/tmp/effective-cwd-dir");
    const { component } = installFooter(pi, ctx);
    const lines = component.render(200).join(" ");
    expect(lines).toContain("effective-cwd-dir");
  });

  it("requests provider values and shows them on install", () => {
    const pi = createMockPi();
    extension(pi as never);
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    const { component } = installFooter(pi, createMockCtx());
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:request", {
      names: ["mode-guard", "usage"],
    });
    publish(pi, "mode-guard", "PLAN");
    const lines = component.render(80);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("PLAN");
  });

  it("skips the footer outside tui mode", () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createMockCtx({ mode: "print" });
    handlers(pi).session_start(undefined as never, ctx as never);
    expect(ctx.ui.setFooter).not.toHaveBeenCalled();
  });

  it("renders branch, cwd, tokens, and model in the default config", () => {
    const pi = createMockPi();
    extension(pi as never);
    const { component } = installFooter(pi, createMockCtx());
    const line = component.render(80)[0] as string;
    expect(line).toContain("main");
    expect(line).toContain("claude-opus-4-6");
    expect(line).toMatch(/↑0/);
    expect(line).toMatch(/\$0\.000/);
  });

  it("re-renders when provider values arrive", () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createMockCtx();
    const { component, tui } = installFooter(pi, ctx);
    expect(component.render(80)[0]).not.toContain("PLAN");
    publish(pi, "mode-guard", "PLAN");
    expect(tui.requestRender).toHaveBeenCalled();
    expect(component.render(80)[0]).toContain("PLAN");
  });

  it("clears the footer on session_shutdown for the owning session", () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createMockCtx();
    installFooter(pi, ctx);
    handlers(pi).session_shutdown(undefined as never, ctx as never);
    expect(ctx.ui.setFooter).toHaveBeenLastCalledWith(undefined);
  });

  it("renders values that arrive before the footer factory runs", () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createMockCtx();
    const setFooter = vi.fn();
    ctx.ui.setFooter = setFooter;
    handlers(pi).session_start(undefined as never, ctx as never);
    publish(pi, "mode-guard", "PLAN");

    const factory = setFooter.mock.calls[0][0];
    const component = factory(
      { requestRender: vi.fn() },
      {},
      { getGitBranch: () => "main", onBranchChange: vi.fn(() => () => {}) },
    );
    expect(component.render(80)[0]).toContain("PLAN");
  });

  it("clears provider values on session_start", () => {
    const pi = createMockPi();
    extension(pi as never);
    publish(pi, "mode-guard", "OLD");
    const { component } = installFooter(pi, createMockCtx());
    expect(component.render(80)[0]).not.toContain("OLD");
  });

  it("runs configured click actions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-statusline-"));
    writeFileSync(
      join(dir, "statusline.json"),
      JSON.stringify({ clickActions: { model: "echo clicked" } }),
    );
    state.agentDir = dir;
    const pi = createMockPi();
    pi.exec.mockResolvedValue({
      stdout: "done\n",
      stderr: "",
      code: 0,
      killed: false,
    });
    extension(pi as never);
    handlers(pi).session_start(undefined as never, createMockCtx() as never);
    const command = pi.registerCommand.mock.calls.find(
      ([name]) => name === "statusline",
    )?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };
    const ctx = createMockCtx();

    await command.handler("click model", ctx);

    expect(pi.exec).toHaveBeenCalledWith("echo", ["clicked"]);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Running: echo clicked", "info");
    expect(ctx.ui.notify).toHaveBeenCalledWith("done", "info");
  });

  it("customizes the working indicator and hidden-thinking label", async () => {
    const pi = createMockPi();
    extension(pi as never);
    const command = pi.registerCommand.mock.calls.find(
      ([name]) => name === "statusline",
    )?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };
    const ctx = createMockCtx();

    await command.handler("working pulse", ctx);
    expect(ctx.ui.setWorkingIndicator).toHaveBeenLastCalledWith({
      frames: ["●", "○"],
      intervalMs: 400,
    });

    await command.handler("thinking reasoning", ctx);
    expect(ctx.ui.setHiddenThinkingLabel).toHaveBeenCalledWith("reasoning");
  });

  it("maps default slash actions", async () => {
    const pi = createMockPi();
    extension(pi as never);
    handlers(pi).session_start(undefined as never, createMockCtx() as never);
    const command = pi.registerCommand.mock.calls.find(
      ([name]) => name === "statusline",
    )?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
    };
    const ctx = createMockCtx();

    await command.handler("click mode", ctx);

    expect(pi.sendUserMessage).toHaveBeenCalledWith("/mode", {
      expandPromptTemplates: true,
    });
  });

  it("ignores model updates from another session", () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createMockCtx();
    const { component } = installFooter(pi, ctx);

    handlers(pi).model_select(
      { model: { id: "other/model" } } as never,
      {
        ...ctx,
        sessionManager: {},
      } as never,
    );

    expect(component.render(80)[0]).toContain("claude-opus-4-6");
  });

  it("falls back to hollowheap.usage custom entry when message cost is 0", () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createMockCtx({
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "assistant",
              usage: { input: 1000, output: 500, cost: { total: 0 } },
            },
          },
          {
            type: "custom",
            customType: "hollowheap.usage",
            data: { totalCost: 0.125 },
          },
        ],
      },
    });
    const { component } = installFooter(pi, ctx);
    const line = component.render(120)[0] as string;
    expect(line).toContain("$0.125");
  });

  it("falls back to model pricing when message cost is 0 and no custom entry exists", () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createMockCtx({
      model: { id: "anthropic/claude-3-5-sonnet" },
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "assistant",
              usage: { input: 100_000, output: 20_000, cost: { total: 0 } },
            },
          },
        ],
      },
    });
    const { component } = installFooter(pi, ctx);
    const line = component.render(120)[0] as string;
    // 100k input @ $3/M = $0.30; 20k output @ $15/M = $0.30; total = $0.60
    expect(line).toContain("$0.600");
  });

  it("sums messageCost over branch assistant entries including cache tokens and mixed provider costs", () => {
    const pi = createMockPi();
    extension(pi as never);
    const ctx = createMockCtx({
      model: { id: "anthropic/claude-3-5-sonnet" },
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "assistant",
              usage: {
                input: 1_000_000,
                output: 0,
                cacheRead: 1_000_000,
                cost: { total: 0 },
              },
            },
          },
          {
            type: "message",
            message: {
              role: "assistant",
              usage: { input: 500_000, output: 100_000, cost: { total: 2.5 } },
            },
          },
        ],
      },
    });
    const { component } = installFooter(pi, ctx);
    const line = component.render(120)[0] as string;
    // Entry 1: 1M input ($3.0) + 1M cacheRead ($0.3) = $3.30
    // Entry 2: provider cost = $2.50
    // Total = $5.80
    expect(line).toContain("$5.800");
  });
});
