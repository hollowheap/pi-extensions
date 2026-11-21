import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerMode } from "@hollowheap/core/modes";
import { BUILTIN_MODE_LAYERS } from "@hollowheap/policy";
import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

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

describe("pi-guard ask and deny decisions at the tool seam", () => {
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

    expect(pi.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "bash" }),
    );
    expect(pi.registerShortcut).toHaveBeenCalledWith(
      "alt+m",
      expect.any(Object),
    );
    expect(pi.registerCommand.mock.calls.map(([name]) => name)).toEqual([
      "grant",
      "context",
      "guard",
      "mode",
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

describe("guard boundary, declined approval and tool_result truncation", () => {
  it("an ask with no UI blocks with a no-UI reason", async () => {
    const { ctx, call } = setup();
    ctx.hasUI = false;
    await expect(call("bash", { command: "echo hi" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("needs approval (no UI)"),
    });
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  it("declining the approval dialog blocks the tool call", async () => {
    const { ctx, call } = setup();
    ctx.ui.confirm.mockResolvedValue(false);
    await expect(call("bash", { command: "echo hi" })).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("was not approved"),
    });
    expect(ctx.ui.confirm).toHaveBeenCalledTimes(1);
  });

  it("long tool output is truncated through the tool_result seam", () => {
    const { pi } = setup();
    const handlers = Object.fromEntries(
      pi.on.mock.calls.map(([event, fn]) => [event, fn]),
    ) as Record<string, (event: never, ctx: never) => unknown>;
    const long = "y".repeat(6000);
    const result = handlers.tool_result?.(
      {
        toolName: "bash",
        content: [{ type: "text", text: long }],
      } as never,
      undefined as never,
    ) as { content: { text: string }[] } | undefined;
    expect(result).toBeDefined();
    expect(result?.content[0].text).toContain("pi-guard");
    expect(result?.content[0].text.length).toBeLessThan(long.length);
  });

  it("reports which shell segment was denied in piped commands", async () => {
    const { call } = setup();
    await expect(
      call("bash", { command: "ls | python -c 'print(1)'" }),
    ).resolves.toEqual({
      block: true,
      reason: expect.stringContaining('dangerous command "python"'),
    });
  });

  it("allows untagged tools annotated as readOnlyHint without prompting", async () => {
    const { pi, ctx, call } = setup();
    (pi as unknown as { getAllTools: () => unknown[] }).getAllTools = () => [
      { name: "mcp_docs_search", annotations: { readOnlyHint: true } },
    ];
    await expect(
      call("mcp_docs_search", { query: "hooks" }),
    ).resolves.toBeUndefined();
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });
});
