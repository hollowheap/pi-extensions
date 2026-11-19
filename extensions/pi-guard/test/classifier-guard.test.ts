import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

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
  return { toolCall, pi };
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
  it("classifier deny blocks a rule-allowed call", async () => {
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

  it("classifier request carries only tool name, tag, and bounded summary", async () => {
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

  it("classifier timeout publishes an audit note and no classifier dialog", async () => {
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

  it("a classifier allow does not block a rule-allowed call", async () => {
    const { toolCall } = capturedGuard();
    const ctx = baseCtx(mkdtempSync(join(tmpdir(), "g-")), {
      findOfType: vi.fn(() => ({ id: "classifier/test" })),
      classify: vi.fn().mockResolvedValue({
        stopReason: "stop",
        answers: { answer: "allow" },
      }),
    });
    const result = await toolCall?.(
      {
        type: "tool_call",
        toolCallId: "t189-c2",
        toolName: "read",
        input: { path: "x" },
      },
      ctx,
    );
    expect((result as { block?: boolean } | undefined)?.block).not.toBe(true);
  });

  it("a hard rule deny is not weakened by a classifier allow", async () => {
    const dir = mkdtempSync(join(tmpdir(), "g-"));
    const { toolCall } = capturedGuard();
    const ctx = baseCtx(dir, {
      findOfType: vi.fn(() => ({ id: "classifier/test" })),
      classify: vi.fn().mockResolvedValue({
        stopReason: "stop",
        answers: { answer: "allow" },
      }),
    });
    writeFileSync(
      join(dir, "permissions.json"),
      JSON.stringify({ rules: ["deny read **"] }),
    );
    (ctx as { isProjectTrusted: () => boolean }).isProjectTrusted = () => true;
    vi.stubEnv("PI_CODING_AGENT_DIR", dir);
    const result = await toolCall?.(
      {
        type: "tool_call",
        toolCallId: "t189-c3",
        toolName: "read",
        input: { path: "x" },
      },
      ctx,
    );
    vi.unstubAllEnvs();
    expect((result as { block?: unknown } | undefined)?.block).toBe(true);
    expect((result as { reason?: unknown } | undefined)?.reason).not.toMatch(
      /classifier/,
    );
  });

  it("a classifier block is recorded in the guard audit", async () => {
    const { toolCall, pi } = capturedGuard();
    const ctx = baseCtx(mkdtempSync(join(tmpdir(), "g-")), {
      findOfType: vi.fn(() => ({ id: "classifier/test" })),
      classify: vi.fn().mockResolvedValue({
        stopReason: "stop",
        answers: { answer: "block" },
      }),
    });
    await toolCall?.(
      {
        type: "tool_call",
        toolCallId: "t189-c4",
        toolName: "read",
        input: { path: "x" },
      },
      ctx,
    );
    expect(pi.appendEntry).toHaveBeenCalled();
  });

  it("the payload carries the tool tag and a bounded 80-char summary", async () => {
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
        toolCallId: "t190-c2",
        toolName: "read",
        input: { path: "a".repeat(500), secret: "hidden" },
      },
      ctx,
    );
    expect(classify).toHaveBeenCalled();
    const payload = classify.mock.calls[0] as unknown[];
    const state = (
      payload[1] as { state: { tool: string; tag: string; summary: string } }
    ).state;
    expect(state.tool).toBe("read");
    expect(typeof state.tag).toBe("string");
    expect(state.summary).toHaveLength(80);
    expect(JSON.stringify(payload)).not.toContain("hidden");
  });

  it("without a registry the call is not sent to a classifier", async () => {
    const { toolCall } = capturedGuard();
    const ctx = baseCtx(mkdtempSync(join(tmpdir(), "g-")), undefined);
    Reflect.deleteProperty(ctx as object, "modelRegistry");
    const result = await toolCall?.(
      {
        type: "tool_call",
        toolCallId: "t190-c3",
        toolName: "read",
        input: { path: "x" },
      },
      ctx,
    );
    expect((result as { block?: boolean } | undefined)?.block).not.toBe(true);
    expect(ctx.ui.notify).not.toHaveBeenCalledWith(
      expect.stringContaining("classifier"),
      "warning",
    );
  });

  it("the classifier model is discovered by type and capability", async () => {
    const { toolCall } = capturedGuard();
    const findOfType = vi.fn(() => ({ id: "classifier/test" }));
    const ctx = baseCtx(mkdtempSync(join(tmpdir(), "g-")), {
      findOfType,
      classify: vi.fn().mockResolvedValue({
        stopReason: "stop",
        answers: { answer: "allow" },
      }),
    });
    await toolCall?.(
      {
        type: "tool_call",
        toolCallId: "t190-c4",
        toolName: "read",
        input: { path: "x" },
      },
      ctx,
    );
    expect(findOfType).toHaveBeenCalledWith(
      "classifier",
      "typesafe",
      "jev-latest",
    );
  });

  it("an aborted classification emits a classifier-error event", async () => {
    const { toolCall, pi } = capturedGuard();
    const ctx = baseCtx(mkdtempSync(join(tmpdir(), "g-")), {
      findOfType: vi.fn(() => ({ id: "classifier/test" })),
      classify: vi.fn().mockResolvedValue({ stopReason: "aborted" }),
    });
    await toolCall?.(
      {
        type: "tool_call",
        toolCallId: "t191-c2",
        toolName: "read",
        input: { path: "x" },
      },
      ctx,
    );
    expect(pi.events.emit).toHaveBeenCalledWith(
      "guard:classifier-error",
      expect.objectContaining({ tool: "read" }),
    );
  });

  it("a model lookup failure notifies the user with a warning", async () => {
    const { toolCall } = capturedGuard();
    const ctx = baseCtx(mkdtempSync(join(tmpdir(), "g-")), {
      findOfType: vi.fn(() => {
        throw new Error("registry down");
      }),
      classify: vi.fn(),
    });
    await toolCall?.(
      {
        type: "tool_call",
        toolCallId: "t191-c3",
        toolName: "read",
        input: { path: "x" },
      },
      ctx,
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("classifier"),
      "warning",
    );
  });

  it("a classifier failure still leaves a rule deny in force", async () => {
    const dir = mkdtempSync(join(tmpdir(), "g-"));
    const { toolCall } = capturedGuard();
    const ctx = baseCtx(dir, {
      findOfType: vi.fn(() => ({ id: "classifier/test" })),
      classify: vi
        .fn()
        .mockResolvedValue({ stopReason: "error", errorMessage: "timeout" }),
    });
    writeFileSync(
      join(dir, "permissions.json"),
      JSON.stringify({ rules: ["deny read **"] }),
    );
    (ctx as { isProjectTrusted: () => boolean }).isProjectTrusted = () => true;
    vi.stubEnv("PI_CODING_AGENT_DIR", dir);
    const result = await toolCall?.(
      {
        type: "tool_call",
        toolCallId: "t191-c4",
        toolName: "read",
        input: { path: "x" },
      },
      ctx,
    );
    vi.unstubAllEnvs();
    expect((result as { block?: unknown } | undefined)?.block).toBe(true);
    expect((result as { reason?: unknown } | undefined)?.reason).not.toMatch(
      /classifier/,
    );
  });
});
