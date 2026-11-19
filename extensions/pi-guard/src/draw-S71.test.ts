import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerMode } from "@hollowheap/core/modes";
import { BUILTIN_MODE_LAYERS } from "@hollowheap/policy";
import { describe, expect, it, vi } from "vitest";

vi.mock("@hollowheap/core/prompt-lock", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, withPromptLock: vi.fn((fn: () => unknown) => fn()) };
});

const state = vi.hoisted(() => ({
  agentDir: "/nonexistent-pi-agent-dir-for-tests",
}));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));
import extension from "./index.js";

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

function setup(
  rules: string,
  options: { confirm?: boolean; hasUI?: boolean } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "pi-guard-draw-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "permissions.json"), rules);
  const pi = {
    on: vi.fn(
      (_event: string, _fn: (...args: unknown[]) => unknown) => () => {},
    ),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    events: { on: vi.fn(() => () => {}), emit: vi.fn() },
  };
  extension(pi as never);
  const handler = pi.on.mock.calls.find(
    ([event]) => event === "tool_call",
  )?.[1] as ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
  if (!handler) throw new Error("missing tool_call handler");
  const ctx = {
    cwd: dir,
    sessionManager: {},
    hasUI: options.hasUI ?? true,
    isProjectTrusted: () => true,
    ui: {
      notify: vi.fn(),
      confirm: vi.fn(async () => options.confirm ?? true),
    },
  };
  return {
    ctx,
    call: (toolName: string, input: unknown) =>
      handler(
        { type: "tool_call", toolCallId: "1", toolName, input } as never,
        ctx as never,
      ),
  };
}

describe("S71: task.start is gated as shell while read/control actions pass", () => {
  it("allows list/status/wait, gates cancel, prompts on ask, and blocks on deny", async () => {
    const { ctx, call } = setup(
      JSON.stringify({
        rules: ["allow shell npm", "deny shell rm"],
      }),
    );

    for (const input of [
      { action: "list" },
      { action: "status", id: "task-1" },
      { action: "wait", id: "task-1" },
      { action: "start", command: "npm test" },
    ]) {
      await expect(call("task", input)).resolves.toBeUndefined();
    }
    expect(ctx.ui.confirm).not.toHaveBeenCalled();

    await expect(
      call("task", { action: "start", command: "rm -rf build" }),
    ).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });
    await expect(
      call("task", { action: "start", command: "cargo build" }),
    ).resolves.toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalledWith("Allow task?", "cargo build", {
      signal: undefined,
    });
  });

  it("S71 C02: blocks an ask-level command when the user declines", async () => {
    const { ctx, call } = setup(JSON.stringify({ rules: ["deny shell rm"] }), {
      confirm: false,
    });
    await expect(
      call("task", { action: "start", command: "cargo build" }),
    ).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("was not approved"),
    });
    expect(ctx.ui.confirm).toHaveBeenCalledTimes(1);
  });

  it("S71 C03: blocks an ask-level command with no UI without prompting", async () => {
    const { ctx, call } = setup(JSON.stringify({ rules: ["deny shell rm"] }), {
      hasUI: false,
    });
    await expect(
      call("task", { action: "start", command: "cargo build" }),
    ).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("needs approval (no UI)"),
    });
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("S71 C04: gates unknown and missing actions as shell commands", async () => {
    const { call } = setup(JSON.stringify({ rules: ["deny shell rm"] }));
    for (const input of [
      { command: "rm -rf build" },
      { action: "bogus", command: "rm -rf build" },
    ]) {
      await expect(call("task", input)).resolves.toEqual({
        block: true,
        reason: expect.stringContaining("denied"),
      });
    }
  });
});
