import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getBudgetUsed, getTokenCap, setTokenCap } from "./budget.js";
import extension from "./index.js";

function createMockPi() {
  return {
    on: vi.fn(
      (_event: string, _fn: (event: never, ctx: never) => unknown) => () => {},
    ),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    events: {
      on: vi.fn((_channel: string, _fn: (data: unknown) => void) => () => {}),
      emit: vi.fn((_channel: string, _data: unknown) => {}),
    },
  };
}

function setupBudget() {
  const dir = mkdtempSync(join(tmpdir(), "pi-budget-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  const pi = createMockPi();
  extension(pi as never);
  const sessionManager = {};
  const ctx = {
    cwd: dir,
    sessionManager,
    hasUI: true,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      confirm: vi.fn(async () => true),
    },
    abort: vi.fn(),
  };
  const commands = Object.fromEntries(
    pi.registerCommand.mock.calls.map(([name, def]) => [name, def]),
  );
  const handlers = Object.fromEntries(
    pi.on.mock.calls.map(([event, fn]) => [event, fn]),
  );
  return {
    pi,
    dir,
    ctx,
    budget: (args: string) => commands.budget.handler(args, ctx as never),
    message: (message: unknown) =>
      handlers.message_end(
        { type: "message_end", message } as never,
        ctx as never,
      ),
    agentStart: () => handlers.before_agent_start({} as never, ctx as never),
  };
}

describe("pi-budgets extension", () => {
  it("registers the budget command and lifecycle hooks", () => {
    const pi = createMockPi();
    extension(pi as never);
    expect(pi.registerCommand.mock.calls.map(([name]) => name)).toEqual([
      "budget",
    ]);
    const events = pi.on.mock.calls.map(([event]) => event).sort();
    expect(events).toEqual([
      "before_agent_start",
      "message_end",
      "session_shutdown",
      "session_start",
    ]);
    expect(pi.events.on).toHaveBeenCalledWith(
      "statusline:request",
      expect.any(Function),
    );
    expect(pi.events.on).toHaveBeenCalledWith(
      "guard:mode-enter",
      expect.any(Function),
    );
  });
});

describe("autopilot cap veto", () => {
  it("vetoes autopilot entry without a token cap", () => {
    const pi = createMockPi();
    extension(pi as never);
    const listener = pi.events.on.mock.calls.find(
      ([channel]) => channel === "guard:mode-enter",
    )?.[1] as (data: unknown) => void;
    const owner = {};
    const query: { mode: string; owner: unknown; veto?: string } = {
      mode: "autopilot",
      owner,
    };
    listener(query);
    expect(query.veto).toContain("set a token cap first");
  });

  it("leaves autopilot entry alone with a token cap", () => {
    const pi = createMockPi();
    extension(pi as never);
    const listener = pi.events.on.mock.calls.find(
      ([channel]) => channel === "guard:mode-enter",
    )?.[1] as (data: unknown) => void;
    const owner = {};
    setTokenCap(owner, 1000);
    const query: { mode: string; owner: unknown; veto?: string } = {
      mode: "autopilot",
      owner,
    };
    listener(query);
    expect(query.veto).toBeUndefined();
  });

  it("ignores other modes", () => {
    const pi = createMockPi();
    extension(pi as never);
    const listener = pi.events.on.mock.calls.find(
      ([channel]) => channel === "guard:mode-enter",
    )?.[1] as (data: unknown) => void;
    const query: { mode: string; owner: unknown; veto?: string } = {
      mode: "plan",
      owner: {},
    };
    listener(query);
    expect(query.veto).toBeUndefined();
  });
});

describe("/budget command", () => {
  it("adds input and output tokens across responses", () => {
    const { ctx, message } = setupBudget();
    message({ role: "assistant", usage: { input: 100, output: 50 } });
    expect(getBudgetUsed(ctx.sessionManager)).toBe(150);
    message({ role: "assistant", usage: { input: 25, output: 25 } });
    expect(getBudgetUsed(ctx.sessionManager)).toBe(200);
    message({ role: "user", content: "hi" });
    expect(getBudgetUsed(ctx.sessionManager)).toBe(200);
  });

  it("reports responses without usage and keeps the total", () => {
    const { ctx, message } = setupBudget();
    message({ role: "assistant" });
    expect(getBudgetUsed(ctx.sessionManager)).toBe(0);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("no usage"),
      "warning",
    );
  });

  it("updates the status line on every response", () => {
    const { ctx, message } = setupBudget();
    message({ role: "assistant", usage: { input: 100, output: 0 } });
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith(
      "budget",
      expect.stringContaining("used"),
    );
  });

  it("sets a cap and prints used and remaining", async () => {
    const { ctx, budget } = setupBudget();
    await budget("100000");
    expect(getTokenCap(ctx.sessionManager)).toBe(100000);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("100,000"),
    );
  });

  it("rejects a cap of 0 or less", async () => {
    const { ctx, budget } = setupBudget();
    for (const arg of ["0", "-5", "1.5", "abc"]) {
      await budget(arg);
    }
    expect(getTokenCap(ctx.sessionManager)).toBeUndefined();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("greater than 0"),
      "error",
    );
  });

  it("prints used and remaining without changing the cap", async () => {
    const { ctx, budget, message } = setupBudget();
    message({ role: "assistant", usage: { input: 1000, output: 0 } });
    await budget("");
    expect(getTokenCap(ctx.sessionManager)).toBeUndefined();
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("no cap set"),
    );
  });

  it("stops the next call past the cap and resumes on raise", async () => {
    const { ctx, budget, message, agentStart } = setupBudget();
    await budget("1000");
    agentStart();
    expect(ctx.abort).not.toHaveBeenCalled();
    message({ role: "assistant", usage: { input: 600, output: 500 } });
    agentStart();
    expect(ctx.abort).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("budget reached"),
      "error",
    );
    await budget("5000");
    agentStart();
    expect(ctx.abort).toHaveBeenCalledTimes(1);
  });

  it("clears totals and cap on session shutdown", async () => {
    const { pi, ctx, budget, message } = setupBudget();
    await budget("1000");
    message({ role: "assistant", usage: { input: 100, output: 0 } });
    expect(getBudgetUsed(ctx.sessionManager)).toBe(100);
    expect(getTokenCap(ctx.sessionManager)).toBe(1000);
    const handlers = Object.fromEntries(
      pi.on.mock.calls.map(([event, fn]) => [event, fn]),
    );
    handlers.session_shutdown(undefined as never, ctx as never);
    expect(getBudgetUsed(ctx.sessionManager)).toBe(0);
    expect(getTokenCap(ctx.sessionManager)).toBeUndefined();
  });
});

describe("statusline values", () => {
  it("publishes an empty budgets value on session start", () => {
    const { pi, ctx } = setupBudget();
    const start = pi.on.mock.calls.find(([event]) => event === "session_start");
    expect(start).toBeDefined();
    start?.[1](undefined as never, ctx as never);
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "budgets",
      text: "",
    });
  });

  it("publishes budget totals", () => {
    const { pi, ctx, message } = setupBudget();
    const start = pi.on.mock.calls.find(([event]) => event === "session_start");
    start?.[1](undefined as never, ctx as never);
    setTokenCap(ctx.sessionManager, 1000);
    message({ role: "assistant", usage: { input: 60, output: 40 } });
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "budgets",
      text: "100 used, 900 remaining",
    });
  });

  it("republishes the current value on statusline request", () => {
    const { pi, ctx, message } = setupBudget();
    const start = pi.on.mock.calls.find(([event]) => event === "session_start");
    start?.[1](undefined as never, ctx as never);
    message({ role: "assistant", usage: { input: 60, output: 40 } });
    const calls = pi.events.emit.mock.calls.length;
    const request = pi.events.on.mock.calls.find(
      ([channel]) => channel === "statusline:request",
    );
    request?.[1](undefined);
    expect(pi.events.emit.mock.calls.length).toBeGreaterThan(calls);
    expect(pi.events.emit).toHaveBeenLastCalledWith("statusline:values", {
      name: "budgets",
      text: "100 used",
    });
  });
});
