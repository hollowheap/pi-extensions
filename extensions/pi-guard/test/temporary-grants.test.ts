import { registerMode } from "@hollowheap/core/modes";
import { BUILTIN_MODE_LAYERS } from "@hollowheap/policy";
import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

const state = vi.hoisted(() => ({
  agentDir: "/nonexistent-pi-agent-dir-for-tests",
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));

function commandHandler(
  pi: { registerCommand: ReturnType<typeof vi.fn> },
  name: string,
): (args: string, ctx: unknown) => Promise<void> {
  const command = pi.registerCommand.mock.calls.find(
    ([registered]) => registered === name,
  )?.[1] as { handler: (args: string, ctx: unknown) => Promise<void> };
  if (command === undefined) throw new Error(`missing command ${name}`);
  return command.handler;
}

describe("temporary permission grants", () => {
  it("grants a path for a duration, lists it, and expires it", async () => {
    vi.useFakeTimers();
    try {
      const pi = {
        on: vi.fn(() => () => {}),
        registerTool: vi.fn(),
        registerCommand: vi.fn(),
        registerShortcut: vi.fn(),
        events: { on: vi.fn(() => () => {}), emit: vi.fn() },
      };
      extension(pi as never);
      const ctx = {
        cwd: "/repo",
        sessionManager: {},
        hasUI: true,
        isProjectTrusted: () => true,
        ui: { notify: vi.fn(), confirm: vi.fn(async () => true) },
      };

      await commandHandler(pi, "grant")("/tmp/granted 30s", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Granted /tmp/granted for 30s",
        "info",
      );

      ctx.ui.notify.mockClear();
      await commandHandler(pi, "grant")("list", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/granted (expires in"),
        "info",
      );

      vi.advanceTimersByTime(31_000);
      ctx.ui.notify.mockClear();
      await commandHandler(pi, "grant")("list", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith("No active grants", "info");
    } finally {
      vi.useRealTimers();
    }
  });

  it("listing on a fresh session reports no grants", async () => {
    const pi = {
      on: vi.fn(() => () => {}),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      events: { on: vi.fn(() => () => {}), emit: vi.fn() },
    };
    extension(pi as never);
    const ctx = {
      cwd: "/repo",
      sessionManager: {},
      hasUI: true,
      isProjectTrusted: () => true,
      ui: { notify: vi.fn(), confirm: vi.fn(async () => true) },
    };
    await commandHandler(pi, "grant")("list", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("No active grants", "info");
  });

  it("an invalid duration is rejected without creating a grant", async () => {
    const pi = {
      on: vi.fn(() => () => {}),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      events: { on: vi.fn(() => () => {}), emit: vi.fn() },
    };
    extension(pi as never);
    const ctx = {
      cwd: "/repo",
      sessionManager: {},
      hasUI: true,
      isProjectTrusted: () => true,
      ui: { notify: vi.fn(), confirm: vi.fn(async () => true) },
    };
    await commandHandler(pi, "grant")("/tmp/nope forever", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Invalid duration. Use e.g. 5m, 1h, 30s",
      "error",
    );
    ctx.ui.notify.mockClear();
    await commandHandler(pi, "grant")("list", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("No active grants", "info");
  });

  it("grants are scoped to their own session owner", async () => {
    const pi = {
      on: vi.fn(() => () => {}),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      events: { on: vi.fn(() => () => {}), emit: vi.fn() },
    };
    extension(pi as never);
    const first = {
      cwd: "/repo",
      sessionManager: {},
      hasUI: true,
      isProjectTrusted: () => true,
      ui: { notify: vi.fn(), confirm: vi.fn(async () => true) },
    };
    const second = {
      ...first,
      sessionManager: {},
      ui: { notify: vi.fn(), confirm: vi.fn(async () => true) },
    };
    await commandHandler(pi, "grant")("/tmp/owned 30s", first);
    await commandHandler(pi, "grant")("list", first);
    expect(first.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("/tmp/owned (expires in"),
      "info",
    );
    await commandHandler(pi, "grant")("list", second);
    expect(second.ui.notify).toHaveBeenCalledWith("No active grants", "info");
  });
});
