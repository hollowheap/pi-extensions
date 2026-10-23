import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { session } from "@hollowheap/core";
import { describe, expect, it, vi } from "vitest";
import autopilotExtension from "../../pi-autopilot/src/index.js";
import budgetsExtension from "../../pi-budgets/src/index.js";
import { createFdTool } from "../../pi-tools/src/fd.js";
import toolsExtension from "../../pi-tools/src/index.js";
import extension from "./index.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => "/nonexistent-pi-agent-dir-for-tests",
}));

const ALL_ALLOW = JSON.stringify({
  rules: ["allow edit *", "allow read *", "allow search *"],
});

function mockPi(bus: EventEmitter) {
  return {
    on: vi.fn(
      (_event: string, _fn: (event: never, ctx: never) => unknown) => () => {},
    ),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    events: {
      on: (channel: string, fn: (data: unknown) => void) => {
        bus.on(channel, fn);
        return () => {};
      },
      emit: (channel: string, data: unknown) => {
        bus.emit(channel, data);
      },
    },
  };
}

function setupAll(rulesFile: string = ALL_ALLOW, withAutopilot = true) {
  const bus = new EventEmitter();
  bus.setMaxListeners(20);
  const dir = mkdtempSync(join(tmpdir(), "pi-split-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  mkdirSync(join(dir, "sub"), { recursive: true });
  writeFileSync(join(dir, ".pi", "permissions.json"), rulesFile);
  const guardPi = mockPi(bus);
  extension(guardPi as never);
  const toolsPi = mockPi(bus);
  toolsExtension(toolsPi as never);
  const budgetsPi = mockPi(bus);
  budgetsExtension(budgetsPi as never);
  if (withAutopilot) {
    const autoPi = mockPi(bus);
    autopilotExtension(autoPi as never);
  }
  const sessionManager = {};
  const ctx = {
    cwd: dir,
    sessionManager,
    hasUI: true,
    isProjectTrusted: () => true,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      confirm: vi.fn(async () => true),
    },
    abort: vi.fn(),
  };
  const guardHandlers = Object.fromEntries(
    guardPi.on.mock.calls.map(([event, fn]) => [event, fn]),
  );
  const budgetsHandlers = Object.fromEntries(
    budgetsPi.on.mock.calls.map(([event, fn]) => [event, fn]),
  );
  const guardCommands = Object.fromEntries(
    guardPi.registerCommand.mock.calls.map(([name, def]) => [name, def]),
  );
  const budgetsCommands = Object.fromEntries(
    budgetsPi.registerCommand.mock.calls.map(([name, def]) => [name, def]),
  );
  const toolsCommands = Object.fromEntries(
    toolsPi.registerCommand.mock.calls.map(([name, def]) => [name, def]),
  );
  return {
    dir,
    ctx,
    start: () => {
      guardHandlers.session_start(undefined as never, ctx as never);
      budgetsHandlers.session_start(undefined as never, ctx as never);
    },
    mode: (args: string) => guardCommands.mode.handler(args, ctx as never),
    budget: (args: string) =>
      budgetsCommands.budget.handler(args, ctx as never),
    cd: (args: string) => toolsCommands.cd.handler(args, ctx as never),
    hook: (toolName: string, input: Record<string, unknown>) =>
      guardHandlers.tool_call(
        { type: "tool_call", toolCallId: "1", toolName, input } as never,
        ctx as never,
      ) as Promise<unknown>,
    shortcut: () =>
      guardPi.registerShortcut.mock.calls[0][1].handler(ctx as never),
  };
}

describe("split extensions over the event bus", () => {
  it("treats autopilot as unknown without pi-autopilot", async () => {
    const env = setupAll(ALL_ALLOW, false);
    env.start();
    await env.mode("autopilot");
    expect(env.ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("unknown mode"),
      "error",
    );
    expect(session(env.ctx.sessionManager).mode).toBe("ask");
  });

  it("cycles ask, edit, plan, autopilot with the cap gate", async () => {
    const env = setupAll();
    env.start();
    expect(session(env.ctx.sessionManager).mode).toBe("ask");
    await env.mode("autopilot");
    expect(env.ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("set a token cap first"),
      "error",
    );
    expect(session(env.ctx.sessionManager).mode).toBe("ask");
    await env.budget("1000");
    await env.mode("autopilot");
    expect(session(env.ctx.sessionManager).mode).toBe("autopilot");
    expect(env.ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("autopilot on"),
      "warning",
    );
    const input = { path: "src/x.ts" };
    await expect(env.hook("write", input)).resolves.toBeUndefined();
    expect(env.ctx.ui.confirm).not.toHaveBeenCalled();
    await env.shortcut();
    expect(session(env.ctx.sessionManager).mode).toBe("ask");
  });

  it("rewrites hook paths after /cd across extensions", async () => {
    const env = setupAll();
    env.start();
    await env.cd("sub");
    expect(env.ctx.ui.setStatus).toHaveBeenCalledWith("cwd", "sub");
    const input = { path: "x.ts" };
    await expect(env.hook("write", input)).resolves.toBeUndefined();
    expect(input.path).toBe(join(env.dir, "sub", "x.ts"));
  });

  it("searches under the /cd directory across extensions", async () => {
    const env = setupAll();
    env.start();
    await env.cd("sub");
    const tool = createFdTool({
      run: async () => "a.ts\n",
      statMtimeMs: (path) =>
        path === join(env.dir, "sub", "a.ts") ? 1 : undefined,
    });
    const result = await tool.execute(
      "call-1",
      { pattern: "*.ts" },
      undefined,
      () => {},
      env.ctx as never,
    );
    const [first] = result.content as [{ type: string; text: string }];
    expect(first.text).toBe("a.ts");
  });

  it("publishes both providers on session start", () => {
    const bus = new EventEmitter();
    const seen: { name: string; text: string }[] = [];
    bus.on("statusline:values", (data) => {
      seen.push(data as { name: string; text: string });
    });
    const dir = mkdtempSync(join(tmpdir(), "pi-split-prov-"));
    const guardPi = mockPi(bus);
    extension(guardPi as never);
    const budgetsPi = mockPi(bus);
    budgetsExtension(budgetsPi as never);
    const sessionManager = {};
    const ctx = {
      cwd: dir,
      sessionManager,
      hasUI: true,
      isProjectTrusted: () => true,
      ui: { notify: vi.fn(), setStatus: vi.fn(), confirm: vi.fn() },
    };
    const guardStart = guardPi.on.mock.calls.find(
      ([event]) => event === "session_start",
    )?.[1] as (event: never, ctx: never) => void;
    const budgetsStart = budgetsPi.on.mock.calls.find(
      ([event]) => event === "session_start",
    )?.[1] as (event: never, ctx: never) => void;
    guardStart(undefined as never, ctx as never);
    budgetsStart(undefined as never, ctx as never);
    expect(seen).toContainEqual({ name: "mode-guard", text: "ASK" });
    expect(seen).toContainEqual({ name: "budgets", text: "" });
  });
});
