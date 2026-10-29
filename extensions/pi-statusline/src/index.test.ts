import { setCwd } from "@hollowheap/core";
import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => "/nonexistent-pi-agent-dir-for-tests",
}));

function createMockPi() {
  return {
    on: vi.fn(
      (_event: string, _fn: (event: never, ctx: never) => void) => () => {},
    ),
    registerCommand: vi.fn(),
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
    cwd: "/home/u/app",
    model: { id: "anthropic/claude-opus-4-6" },
    sessionManager: { getBranch: () => [] },
    getContextUsage: () => ({
      tokens: 1000,
      contextWindow: 200000,
      percent: 0.5,
    }),
    ui: { setFooter: vi.fn(), notify: vi.fn(), setStatus: vi.fn() },
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
      names: ["mode-guard", "budgets"],
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
});
