import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

function capturedGuard() {
  let toolCall:
    | ((event: unknown, ctx: unknown) => Promise<unknown>)
    | undefined;
  const pi = {
    on: vi.fn(
      (
        event: string,
        fn: (event: unknown, ctx: unknown) => Promise<unknown>,
      ) => {
        if (event === "tool_call") toolCall = fn;
        return () => {};
      },
    ),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    registerTool: vi.fn(),
    events: { on: vi.fn(() => () => {}), emit: vi.fn() },
    appendEntry: vi.fn(),
    getCommands: vi.fn(() => []),
    setActiveTools: vi.fn(),
    getAllTools: vi.fn(() => []),
  };
  extension(pi as never);
  return { toolCall };
}

function baseCtx(agentDir: string, classify: unknown) {
  writeFileSync(
    join(agentDir, "permissions.json"),
    JSON.stringify({ rules: ["allow edit *", "allow read *"] }),
  );
  return {
    cwd: agentDir,
    sessionManager: { getBranch: vi.fn(() => []) },
    isProjectTrusted: () => false,
    hasUI: true,
    modelRegistry: classify,
    ui: {
      notify: vi.fn(),
      confirm: vi.fn().mockResolvedValue(true),
      custom: vi.fn(),
      select: vi.fn(),
    },
  };
}

describe("classifier guard layer", () => {
  it("S189 C01: classifier deny blocks a rule-allowed call", async () => {
    const { toolCall } = capturedGuard();
    const ctx = baseCtx(mkdtempSync(join(tmpdir(), "g-")), {
      findOfType: vi.fn(() => ({ id: "classifier/test" })),
      classify: vi.fn().mockResolvedValue({
        stopReason: "stop",
        answers: { answer: "block" },
      }),
    });
    const result = await toolCall?.(
      {
        type: "tool_call",
        toolCallId: "t1",
        toolName: "read",
        input: { path: "x" },
      },
      ctx,
    );
    expect(result).toEqual(
      expect.objectContaining({
        block: true,
        reason: expect.stringContaining("classifier"),
      }),
    );
  });

  it("S190 C01: classifier request carries only tool name, tag, and bounded summary", async () => {
    const { toolCall } = capturedGuard();
    const classify = vi
      .fn()
      .mockResolvedValue({ stopReason: "stop", answers: { answer: "allow" } });
    const ctx = baseCtx(mkdtempSync(join(tmpdir(), "g-")), {
      findOfType: vi.fn(() => ({ id: "classifier/test" })),
      classify,
    });
    await toolCall?.(
      {
        type: "tool_call",
        toolCallId: "t2",
        toolName: "read",
        input: { path: "x", secret: "hidden" },
      },
      ctx,
    );
    expect(classify).toHaveBeenCalled();
    const payload = JSON.stringify(classify.mock.calls[0] ?? []);
    expect(payload).toContain("read");
    expect(payload).not.toContain("hidden");
    expect(payload).not.toContain(ctx.cwd);
  });

  it("S191 C01: classifier timeout publishes an audit note and no classifier dialog", async () => {
    const { toolCall } = capturedGuard();
    const audit = { warn: vi.fn() };
    const ctx = baseCtx(mkdtempSync(join(tmpdir(), "g-")), {
      findOfType: vi.fn(() => ({ id: "classifier/test" })),
      classify: vi
        .fn()
        .mockResolvedValue({ stopReason: "error", errorMessage: "timeout" }),
    });
    (ctx as { audit?: unknown }).audit = audit;
    await toolCall?.(
      {
        type: "tool_call",
        toolCallId: "t3",
        toolName: "read",
        input: { path: "x" },
      },
      ctx,
    );
    expect(audit.warn).toHaveBeenCalledWith(
      expect.stringContaining("classifier"),
    );
    expect(ctx.ui.custom).not.toHaveBeenCalled();
  });
});
