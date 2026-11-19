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
import extension from "../src/index.js";

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

describe("task permission routing", () => {
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
    await expect(
      call("task", { action: "cancel", id: "task-1" }),
    ).resolves.toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalledTimes(2);
  });

  it("blocks an ask-level start or cancel when the user declines", async () => {
    const { ctx, call } = setup(JSON.stringify({ rules: ["deny shell rm"] }), {
      confirm: false,
    });
    for (const input of [
      { action: "start", command: "cargo build" },
      { action: "cancel", id: "task-1" },
    ]) {
      await expect(call("task", input)).resolves.toEqual({
        block: true,
        reason: expect.stringContaining("was not approved"),
      });
    }
    expect(ctx.ui.confirm).toHaveBeenCalledTimes(2);
  });

  it("blocks an ask-level start or cancel when no UI is available", async () => {
    const { ctx, call } = setup(JSON.stringify({ rules: ["deny shell rm"] }), {
      hasUI: false,
    });
    for (const input of [
      { action: "start", command: "cargo build" },
      { action: "cancel", id: "task-1" },
    ]) {
      await expect(call("task", input)).resolves.toEqual({
        block: true,
        reason: expect.stringContaining("needs approval (no UI)"),
      });
    }
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("applies the shell deny to unknown, missing, and cancel actions", async () => {
    const { call } = setup(
      JSON.stringify({ rules: ["deny shell rm", "deny shell subagent"] }),
    );
    for (const input of [
      { command: "rm -rf build" },
      { action: "bogus", command: "rm -rf build" },
      { action: "cancel", id: "task-1" },
    ]) {
      await expect(call("task", input)).resolves.toEqual({
        block: true,
        reason: expect.stringContaining("denied"),
      });
    }
  });
});
