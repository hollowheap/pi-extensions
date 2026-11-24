import type {
  ExtensionContext,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { registerCodemodeTools } from "../src/codemode.js";

function setup() {
  type Handler = (event: unknown, ctx: ExtensionContext) => void;
  const tools = new Map<string, ToolDefinition>();
  const handlers = new Map<string, Handler>();
  const cancelCompaction = registerCodemodeTools({
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    on: (name: string, handler: Handler) => handlers.set(name, handler),
  } as never);
  const executeTool = vi.fn<ExtensionToolContext["executeTool"]>();
  const compact = vi.fn();
  const ctx = {
    sessionManager: {},
    executeTool,
    compact,
    isIdle: () => true,
    hasPendingMessages: () => false,
  } as unknown as ExtensionToolContext;
  return {
    executeTool,
    compact,
    execute: (
      name: string,
      args: unknown,
      signal?: AbortSignal,
      ctxOverride: ExtensionToolContext = ctx,
    ) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Missing tool ${name}`);
      expect(tool.exposure).toBe("codemode");
      return tool.execute("tool-id", args, signal, undefined, ctxOverride);
    },
    reachesTools: (name: string, input: unknown) =>
      tools.get(name)?.reachesTools?.(input as Record<string, unknown>),
    cancel: () => cancelCompaction(ctx),
    emit: (name: string, event: unknown = {}) =>
      handlers.get(name)?.(event, ctx),
  };
}

function outcome(name: string, text: string, isError = false) {
  return {
    isError,
    toolCall: { type: "toolCall" as const, id: "child", name, arguments: {} },
    result: { content: [{ type: "text" as const, text }], details: {} },
  };
}

describe("codemode utilities", () => {
  it("batches calls to one tool with bounded concurrency and ordered outcomes", async () => {
    const { execute, executeTool } = setup();
    let finishFirst!: (result: ReturnType<typeof outcome>) => void;
    executeTool
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(outcome("read", "Permission denied", true))
      .mockResolvedValueOnce({
        ...outcome("read", "ignored text"),
        result: { content: [], details: {}, structuredContent: { size: 10 } },
      });
    const result = execute("batch", {
      tool: "read",
      args: [{ path: "a" }, { path: "b" }, { path: "c" }],
      concurrency: 2,
    });
    expect(executeTool.mock.calls.map((entry) => entry.slice(0, 2))).toEqual([
      ["read", { path: "a" }],
      ["read", { path: "b" }],
    ]);
    finishFirst(outcome("read", "hello"));
    const finished = await result;
    expect(finished.structuredContent).toEqual({
      results: [
        { tool: "read", status: "ok", value: "hello" },
        { tool: "read", status: "error", error: "Permission denied" },
        { tool: "read", status: "ok", value: { size: 10 } },
      ],
    });
    expect(finished.content).toEqual([
      { type: "text", text: "Batch finished (3 calls)" },
      { type: "text", text: "read: ok hello" },
      { type: "text", text: "read: error Permission denied" },
      { type: "text", text: 'read: ok {"size":10}' },
    ]);
  });

  it("reports recursion as an error and stops scheduling calls after abort", async () => {
    const { execute, executeTool } = setup();
    const abort = new AbortController();
    executeTool.mockImplementationOnce(async () => {
      abort.abort();
      return outcome("read", "aborted", true);
    });
    const result = await execute(
      "batch",
      {
        calls: [
          { tool: "batch", args: {} },
          { tool: "read", args: {} },
          { tool: "edit", args: {} },
        ],
        concurrency: 1,
      },
      abort.signal,
    );
    expect(executeTool).toHaveBeenCalledExactlyOnceWith(
      "read",
      {},
      { signal: abort.signal },
    );
    expect(result.structuredContent).toEqual({
      results: [
        {
          tool: "batch",
          status: "error",
          error: "Cannot call batch from batch",
        },
        { tool: "read", status: "cancelled" },
        { tool: "edit", status: "cancelled" },
      ],
    });
  });

  it("queues one compaction until the agent settles", async () => {
    const { execute, compact, emit } = setup();
    expect(
      (
        await execute("compact_context", {
          instructions: "Retain test results",
        })
      ).structuredContent,
    ).toEqual({ status: "queued" });
    expect((await execute("compact_context", {})).structuredContent).toEqual({
      status: "already_queued",
    });
    expect(compact).not.toHaveBeenCalled();
    emit("agent_settled", { aborted: false });
    emit("agent_settled", { aborted: false });
    expect(compact).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ customInstructions: "Retain test results" }),
    );
  });

  it("clears queued compaction for aborts and branch switches", async () => {
    const { execute, compact, emit, cancel } = setup();
    await execute("compact_context", {});
    emit("agent_settled", { aborted: true });
    await execute("compact_context", {});
    cancel();
    emit("agent_settled", { aborted: false });
    expect(compact).not.toHaveBeenCalled();
  });

  it("handles missing sessionManager in compact_context and non-object input in reachesTools", async () => {
    const { execute, reachesTools } = setup();
    const result = await execute("compact_context", {}, undefined, {} as never);
    expect(result.content).toEqual([
      { type: "text", text: "compact_context requires an active session." },
    ]);
    expect(reachesTools("batch", null)).toEqual([]);
    expect(reachesTools("batch", undefined)).toEqual([]);
    expect(reachesTools("batch", "read")).toEqual([]);
    expect(reachesTools("batch", { tool: "read" })).toEqual(["read"]);
  });

  it("accepts a bare call array for batch and a bare string for compact_context", async () => {
    const { execute, executeTool, reachesTools, compact, emit } = setup();
    executeTool
      .mockResolvedValueOnce(outcome("read", "alpha"))
      .mockResolvedValueOnce(outcome("grep", "beta"));

    const calls = [
      { tool: "read", args: { path: "a.ts" } },
      { tool: "grep", args: { pattern: "foo" } },
    ];
    expect(reachesTools("batch", calls)).toEqual(["read", "grep"]);

    const batchRes = await execute("batch", calls);
    expect(batchRes.structuredContent).toEqual({
      results: [
        { tool: "read", status: "ok", value: "alpha" },
        { tool: "grep", status: "ok", value: "beta" },
      ],
    });
    expect(batchRes.content).toEqual([
      { type: "text", text: "Batch finished (2 calls)" },
      { type: "text", text: "read: ok alpha" },
      { type: "text", text: "grep: ok beta" },
    ]);

    const compactRes = await execute("compact_context", "Keep auth decisions");
    expect(compactRes.structuredContent).toEqual({ status: "queued" });
    emit("agent_settled", { aborted: false });
    expect(compact).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ customInstructions: "Keep auth decisions" }),
    );
  });
});
