import { describe, expect, it, vi } from "vitest";
import { registerMode } from "@hollowheap/core/modes";
import { BUILTIN_MODE_LAYERS } from "@hollowheap/policy";
import extension from "./index.js";

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

describe("S135 temporary permission grants", () => {
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
      await commandHandler(pi, "grants")("", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/granted (expires in"),
        "info",
      );

      vi.advanceTimersByTime(31_000);
      ctx.ui.notify.mockClear();
      await commandHandler(pi, "grants")("", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith("No active grants", "info");
    } finally {
      vi.useRealTimers();
    }
  });
});
