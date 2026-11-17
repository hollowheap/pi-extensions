import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerMode } from "@hollowheap/core/modes";
import { BUILTIN_MODE_LAYERS } from "@hollowheap/policy";
import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

const state = vi.hoisted(() => ({
  agentDir: "/nonexistent-pi-agent-dir-for-tests",
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));
vi.mock("@hollowheap/core/prompt-lock", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, withPromptLock: vi.fn((fn: () => unknown) => fn()) };
});

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

function mockPi() {
  return {
    on: vi.fn(
      (_event: string, _fn: (event: never, ctx: never) => unknown) => () => {},
    ),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    events: { on: vi.fn(), emit: vi.fn() },
  };
}

function ctxFor(cwd: string) {
  return {
    cwd,
    sessionManager: {},
    hasUI: true,
    isProjectTrusted: () => true,
    ui: { notify: vi.fn(), confirm: vi.fn(async () => true) },
  };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "pi-guard-draw-s12-"));
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(
    join(dir, ".pi", "permissions.json"),
    JSON.stringify({ rules: ["deny edit src/*"] }),
  );
  const pi = mockPi();
  extension(pi as never);
  const ctx = ctxFor(dir);
  const call = pi.on.mock.calls.find(([event]) => event === "tool_call");
  expect(call).toBeDefined();
  const handler = call?.[1] as (event: never, ctx: never) => Promise<unknown>;
  return {
    pi,
    ctx,
    call: (toolName: string, input: unknown) =>
      handler(
        {
          type: "tool_call",
          toolCallId: "1",
          toolName,
          input,
        } as never,
        ctx as never,
      ),
  };
}

describe("S12: pi-guard ask and deny decisions at the tool seam", () => {
  it("confirms with the full command on ask and blocks a denied edit", async () => {
    const { pi, ctx, call } = setup();

    const longCommand = `echo ${"x".repeat(600)}`;
    await expect(
      call("bash", { command: longCommand }),
    ).resolves.toBeUndefined();
    expect(ctx.ui.confirm).toHaveBeenCalledWith("Allow bash?", longCommand, {
      signal: undefined,
    });

    await expect(call("edit", { path: "src/a.ts" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("denied"),
    });

    expect(pi.registerTool).not.toHaveBeenCalled();
    expect(pi.registerShortcut).not.toHaveBeenCalled();
    expect(pi.registerCommand.mock.calls.map(([name]) => name)).toEqual([
      "grant",
      "grants",
      "context",
      "guard",
    ]);

    const handlers = Object.fromEntries(
      pi.on.mock.calls.map(([event, fn]) => [event, fn]),
    );
    const provider = ctxFor("/tmp/pi-guard-s12-provider");
    handlers.session_start?.(undefined as never, provider as never);
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "mode-guard",
      text: "MANUAL",
    });
  });
});
