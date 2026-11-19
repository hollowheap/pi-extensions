import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getSessionSnapshot } from "@hollowheap/core/snapshot";
import { USAGE_ENTRY_TYPE } from "@hollowheap/core/usage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryExtension } from "../src/index.js";
import {
  MEMORY_CLEAR_TYPE,
  MEMORY_CONSUMED_TYPE,
  MEMORY_OBSERVATION_TYPE,
} from "../src/ledger.js";
import { MEMORY_CONFIG_FILE } from "../src/settings.js";

const pagerMock = vi.hoisted(() => ({ show: vi.fn() }));
const workspaceFixtures: string[] = [];

vi.mock("@hollowheap/pi-ui/pager", () => ({
  showMarkdownPager: pagerMock.show,
}));

function createMockPi() {
  const eventHandlers: Record<string, (data: unknown) => void> = {};
  return {
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
    appendEntry: vi.fn(),
    events: {
      emit: vi.fn(),
      on: vi.fn((event: string, handler: (data: unknown) => void) => {
        eventHandlers[event] = handler;
      }),
    },
    eventHandlers,
  };
}

function configDir(overrides: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-memory-"));
  writeFileSync(
    join(dir, MEMORY_CONFIG_FILE),
    JSON.stringify({
      enabled: true,
      model: "provider/model-id",
      observeAfterTokens: 1_000,
      ...overrides,
    }),
  );
  return dir;
}

function observationEntry(text = "Prefer small commits") {
  return {
    type: "custom",
    customType: MEMORY_OBSERVATION_TYPE,
    data: {
      id: "obs1",
      text,
      relevance: 4,
      createdAt: 1,
      sourceEntryIds: ["m0"],
    },
  };
}

function messageEntry(id: string, text: string) {
  return {
    type: "message",
    id,
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  };
}

function createCtx(branch: unknown[]) {
  return {
    cwd: "/repo",
    hasUI: true,
    mode: "tui",
    sessionManager: {
      getBranch: () => branch,
      getEntries: () => branch,
      getSessionId: () => "session-1",
    },
    modelRegistry: {
      find: vi.fn().mockReturnValue({ id: "memory-model" }),
      hasConfiguredAuth: vi.fn().mockReturnValue(true),
      getApiKeyAndHeaders: vi
        .fn()
        .mockResolvedValue({ ok: true, apiKey: "key", headers: { x: "y" } }),
      complete: vi.fn(),
    },
    model: { id: "main-model" },
    ui: { notify: vi.fn(), confirm: vi.fn().mockResolvedValue(true) },
    isIdle: () => true,
    isProjectTrusted: () => true,
  };
}

function handler(pi: ReturnType<typeof createMockPi>, event: string) {
  return pi.on.mock.calls.find(([name]) => name === event)?.[1] as
    | ((event: unknown, ctx: unknown) => unknown)
    | undefined;
}

function memoryCommand(pi: ReturnType<typeof createMockPi>) {
  return pi.registerCommand.mock.calls.find(
    ([name]) => name === "memory",
  )?.[1] as
    | {
        handler: (args: string, ctx: unknown) => Promise<void>;
        getArgumentCompletions?: (
          prefix: string,
        ) => Array<{ value: string; label: string }> | null;
      }
    | undefined;
}

function memoryTool(pi: ReturnType<typeof createMockPi>, name: string) {
  return pi.registerTool.mock.calls.find(([tool]) => tool.name === name)?.[0] as
    | {
        execute: (
          id: string,
          params: Record<string, unknown>,
          signal: undefined,
          onUpdate: undefined,
          ctx: unknown,
        ) => Promise<{ content: Array<{ text: string }> }>;
      }
    | undefined;
}

afterEach(() => {
  Reflect.deleteProperty(process.env, "PI_ACP");
  for (const path of workspaceFixtures.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("pi-memory extension", () => {
  it("does nothing when disabled", async () => {
    const pi = createMockPi();
    const observe = vi.fn();
    const dir = configDir({ enabled: false });
    createMemoryExtension({
      getAgentDir: () => dir,
      observe: observe as never,
    })(pi as never);

    const ctx = createCtx([messageEntry("m1", "x".repeat(5_000))]);
    await handler(pi, "agent_settled")?.({ aborted: false }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observe).not.toHaveBeenCalled();
    expect(pi.appendEntry).not.toHaveBeenCalled();
  });

  it("observes pending messages, records usage, and refreshes usage", async () => {
    const pi = createMockPi();
    const observe = vi.fn().mockResolvedValue({
      observations: [{ text: "Use pnpm", relevance: 5 }],
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
      },
    });
    const dir = configDir();
    createMemoryExtension({
      getAgentDir: () => dir,
      observe: observe as never,
    })(pi as never);

    const ctx = createCtx([messageEntry("m1", "x".repeat(5_000))]);
    await handler(pi, "agent_settled")?.({ aborted: false }, ctx);

    await vi.waitFor(() => {
      expect(pi.appendEntry).toHaveBeenCalledWith(
        MEMORY_OBSERVATION_TYPE,
        expect.objectContaining({
          text: "Use pnpm",
          relevance: 5,
          sourceEntryIds: ["m1"],
          coversUpToId: "m1",
        }),
      );
    });
    expect(pi.appendEntry).toHaveBeenCalledWith(
      USAGE_ENTRY_TYPE,
      expect.objectContaining({
        byModel: expect.objectContaining({
          "memory-model": expect.objectContaining({
            inputTokens: 10,
            cost: 0.01,
          }),
        }),
      }),
    );
    expect(pi.events.emit).toHaveBeenCalledWith("usage:refresh", undefined);
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({ redact: true, remaining: 50 }),
    );
  });

  it("does not observe the same messages twice", async () => {
    const pi = createMockPi();
    const observe = vi.fn().mockResolvedValue({
      observations: [{ text: "Use pnpm", relevance: 5 }],
    });
    const dir = configDir();
    createMemoryExtension({
      getAgentDir: () => dir,
      observe: observe as never,
    })(pi as never);

    const ctx = createCtx([messageEntry("m1", "x".repeat(5_000))]);
    await handler(pi, "agent_settled")?.({ aborted: false }, ctx);
    await vi.waitFor(() => expect(observe).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(pi.appendEntry).toHaveBeenCalledWith(
        MEMORY_OBSERVATION_TYPE,
        expect.anything(),
      ),
    );

    await handler(pi, "agent_settled")?.({ aborted: false }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it("does not consume messages when the observer fails", async () => {
    const pi = createMockPi();
    const observe = vi.fn().mockRejectedValue(new Error("provider down"));
    const dir = configDir({ notifyErrors: true });
    createMemoryExtension({
      getAgentDir: () => dir,
      observe: observe as never,
    })(pi as never);

    const ctx = createCtx([messageEntry("m1", "x".repeat(5_000))]);
    await handler(pi, "agent_settled")?.({ aborted: false }, ctx);

    await vi.waitFor(() => {
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "pi-memory: provider down",
        "warning",
      );
    });
    expect(pi.appendEntry).not.toHaveBeenCalledWith(
      MEMORY_OBSERVATION_TYPE,
      expect.anything(),
    );
    expect(pi.appendEntry).not.toHaveBeenCalledWith(
      MEMORY_CONSUMED_TYPE,
      expect.anything(),
    );
  });

  it("leaves messages unconsumed when the model response has stopReason error", async () => {
    const pi = createMockPi();
    const dir = configDir({ notifyErrors: true });
    createMemoryExtension({
      getAgentDir: () => dir,
    })(pi as never);

    const ctx = createCtx([messageEntry("m1", "x".repeat(5_000))]);
    ctx.modelRegistry.complete = vi.fn().mockResolvedValue({
      content: [],
      stopReason: "error",
      errorMessage: "429 rate limited",
    });

    await handler(pi, "agent_settled")?.({ aborted: false }, ctx);
    await vi.waitFor(() => {
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "pi-memory: 429 rate limited",
        "warning",
      );
    });
    expect(pi.appendEntry).not.toHaveBeenCalledWith(
      MEMORY_CONSUMED_TYPE,
      expect.anything(),
    );
  });

  it("suppresses duplicate error notifications and advances after repeated failures", async () => {
    const pi = createMockPi();
    const dir = configDir({ notifyErrors: true });
    createMemoryExtension({
      getAgentDir: () => dir,
    })(pi as never);

    const ctx = createCtx([messageEntry("m1", "x".repeat(5_000))]);
    ctx.modelRegistry.complete = vi.fn().mockResolvedValue({
      content: [],
      stopReason: "length",
    });

    // First attempt fails and notifies once
    await handler(pi, "agent_settled")?.({ aborted: false }, ctx);
    await vi.waitFor(() => {
      expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    });

    // Second consecutive attempt suppresses duplicate notification and advances
    await handler(pi, "agent_settled")?.({ aborted: false }, ctx);
    await vi.waitFor(() => {
      expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    });
  });

  it("persists the consumed watermark after repeated failures so restore skips the chunk", async () => {
    const pi = createMockPi();
    const dir = configDir();
    const observe = vi.fn().mockRejectedValue(new Error("down"));
    createMemoryExtension({
      getAgentDir: () => dir,
      observe: observe as never,
    })(pi as never);

    const branch: unknown[] = [messageEntry("m1", "x".repeat(5_000))];
    const ctx = createCtx(branch);

    await handler(pi, "agent_settled")?.({ aborted: false }, ctx);
    await vi.waitFor(() => expect(observe).toHaveBeenCalledTimes(1));
    await handler(pi, "agent_settled")?.({ aborted: false }, ctx);
    await vi.waitFor(() => expect(observe).toHaveBeenCalledTimes(2));

    expect(pi.appendEntry).toHaveBeenCalledWith(MEMORY_CONSUMED_TYPE, {
      sourceEntryIds: ["m1"],
    });

    branch.push({
      type: "custom",
      customType: MEMORY_CONSUMED_TYPE,
      data: { sourceEntryIds: ["m1"] },
    });
    handler(pi, "session_start")?.({}, ctx);
    await handler(pi, "agent_settled")?.({ aborted: false }, ctx);
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it("marks messages consumed when the observer returns no observations", async () => {
    const pi = createMockPi();
    const observe = vi.fn().mockResolvedValue({ observations: [] });
    const dir = configDir();
    createMemoryExtension({
      getAgentDir: () => dir,
      observe: observe as never,
    })(pi as never);

    const ctx = createCtx([messageEntry("m1", "x".repeat(5_000))]);
    await handler(pi, "agent_settled")?.({ aborted: false }, ctx);

    await vi.waitFor(() => {
      expect(pi.appendEntry).toHaveBeenCalledWith(MEMORY_CONSUMED_TYPE, {
        sourceEntryIds: ["m1"],
      });
    });
  });

  it("discards an in-flight observation after branch navigation", async () => {
    const pi = createMockPi();
    let resolve!: (value: unknown) => void;
    const observe = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const dir = configDir();
    createMemoryExtension({
      getAgentDir: () => dir,
      observe: observe as never,
    })(pi as never);

    const branch = [messageEntry("m1", "x".repeat(5_000))];
    const ctx = createCtx(branch);
    await handler(pi, "agent_settled")?.({ aborted: false }, ctx);
    await vi.waitFor(() => expect(observe).toHaveBeenCalled());

    branch.length = 0;
    await handler(pi, "session_tree")?.({}, ctx);
    resolve({ observations: [{ text: "Should not persist", relevance: 3 }] });
    await new Promise((done) => setTimeout(done, 0));

    expect(pi.appendEntry).not.toHaveBeenCalledWith(
      MEMORY_OBSERVATION_TYPE,
      expect.anything(),
    );
  });

  it("injects memory into compaction and records the returned usage once", async () => {
    const pi = createMockPi();
    const compaction = {
      summary: "summary with memory",
      firstKeptEntryId: "m0",
      tokensBefore: 100,
      usage: {
        input: 25,
        output: 5,
        cacheRead: 10,
        cacheWrite: 0,
        totalTokens: 40,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.2 },
      },
    };
    const compact = vi.fn().mockResolvedValue(compaction);
    const dir = configDir();
    createMemoryExtension({
      getAgentDir: () => dir,
      observe: vi.fn() as never,
      compact: compact as never,
    })(pi as never);

    const branch = [observationEntry()];
    const ctx = createCtx([
      ...branch,
      {
        type: "custom",
        customType: USAGE_ENTRY_TYPE,
        data: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 15,
          totalCost: 0.1,
        },
      },
    ]);
    await handler(pi, "session_start")?.({}, ctx);

    const result = await handler(pi, "session_before_compact")?.(
      {
        preparation: { firstKeptEntryId: "m0" },
        customInstructions: "focus on tests",
        signal: new AbortController().signal,
      },
      ctx,
    );

    expect(result).toEqual({ compaction });
    expect(compact).toHaveBeenCalledTimes(1);
    expect(compact).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "main-model" }),
      "key",
      { x: "y" },
      expect.stringContaining("focus on tests"),
      expect.any(AbortSignal),
    );
    expect(compact.mock.calls[0]?.[4]).toContain("Prefer small commits");
    expect(
      pi.appendEntry.mock.calls.filter(([type]) => type === USAGE_ENTRY_TYPE),
    ).toEqual([
      [
        USAGE_ENTRY_TYPE,
        expect.objectContaining({
          totalTokens: 55,
          totalCost: 0.3,
        }),
      ],
    ]);
    await memoryCommand(pi)?.handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("last compaction: main-model, 30 tokens, $0.20"),
      "info",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("last observer: none"),
      "info",
    );
  });

  it("discards a compaction that finishes after branch navigation", async () => {
    const pi = createMockPi();
    let finishCompaction!: (value: unknown) => void;
    const compact = vi.fn(
      () =>
        new Promise((resolve) => {
          finishCompaction = resolve;
        }),
    );
    const dir = configDir();
    createMemoryExtension({
      getAgentDir: () => dir,
      compact: compact as never,
    })(pi as never);

    const branch = [observationEntry()];
    const ctx = createCtx(branch);
    await handler(pi, "session_start")?.({}, ctx);
    const result = handler(pi, "session_before_compact")?.(
      {
        preparation: { firstKeptEntryId: "m0" },
        signal: new AbortController().signal,
      },
      ctx,
    );
    await vi.waitFor(() => expect(compact).toHaveBeenCalledTimes(1));
    branch.length = 0;
    await handler(pi, "session_tree")?.({}, ctx);
    finishCompaction({
      summary: "old branch summary",
      firstKeptEntryId: "m0",
      tokensBefore: 100,
      usage: { input: 25, output: 5, cost: { total: 0.2 } },
    });

    expect(await result).toEqual({ cancel: true });
    expect(pi.appendEntry).not.toHaveBeenCalledWith(
      USAGE_ENTRY_TYPE,
      expect.anything(),
    );
  });

  it("compacts a covered retained prefix without losing prior summary or file metadata", async () => {
    const pi = createMockPi();
    const compact = vi.fn().mockResolvedValue({
      summary: "model summary",
      firstKeptEntryId: "kept",
      tokensBefore: 2_000,
    });
    const dir = configDir({ deterministicCompaction: true });
    createMemoryExtension({ getAgentDir: () => dir, compact })(pi as never);
    const observation = observationEntry();
    const previouslyCompacted = messageEntry("old", "already summarized");
    const covered = messageEntry("covered", "covered in the retained history");
    const previousSummary = "Previously saved project constraints";
    const branch = [
      previouslyCompacted,
      covered,
      {
        ...observation,
        data: {
          ...observation.data,
          sourceEntryIds: ["covered"],
          coversUpToId: "covered",
        },
      },
      messageEntry("kept", "still visible"),
      {
        type: "compaction",
        id: "previous",
        firstKeptEntryId: "covered",
        summary: previousSummary,
        fromHook: true,
        details: { readFiles: ["old-read"], modifiedFiles: ["old-write"] },
      },
    ];
    const ctx = createCtx(branch);
    await handler(pi, "session_start")?.({}, ctx);
    const result = await handler(pi, "session_before_compact")?.(
      {
        branchEntries: branch,
        preparation: {
          firstKeptEntryId: "kept",
          messagesToSummarize: [covered.message],
          turnPrefixMessages: [],
          isSplitTurn: false,
          tokensBefore: 2_000,
          previousSummary,
          fileOps: {
            read: new Set(["new-read", "old-write"]),
            written: new Set(["new-write"]),
            edited: new Set(),
          },
        },
        signal: new AbortController().signal,
      },
      ctx,
    );

    expect(result).toMatchObject({
      compaction: {
        summary: expect.stringContaining(previousSummary),
        firstKeptEntryId: "kept",
        tokensBefore: 2_000,
        details: {
          readFiles: ["new-read", "old-read"],
          modifiedFiles: ["new-write", "old-write"],
        },
      },
    });
    expect(ctx.modelRegistry.getApiKeyAndHeaders).not.toHaveBeenCalled();
    expect(compact).not.toHaveBeenCalled();
    expect(pi.appendEntry).not.toHaveBeenCalled();
  });

  it("adds each discarded observation and tracked-file block once across consecutive local compactions", async () => {
    const pi = createMockPi();
    const compact = vi.fn();
    const dir = configDir({ deterministicCompaction: true });
    createMemoryExtension({ getAgentDir: () => dir, compact })(pi as never);

    const observation = observationEntry();
    const observed = (id: string, text: string, sourceEntryIds: string[]) => ({
      ...observation,
      data: {
        ...observation.data,
        id,
        text,
        sourceEntryIds,
        coversUpToId: sourceEntryIds.at(-1),
      },
    });
    const first = messageEntry("first", "first source");
    const next = messageEntry("next", "next source");
    const kept = messageEntry("kept", "still visible");
    const branch: unknown[] = [
      first,
      next,
      observed("batch", "A recurring batch fact", ["first", "next"]),
      kept,
      observed("retained", "Unrelated retained fact", ["kept"]),
    ];
    const ctx = createCtx(branch);
    await handler(pi, "session_start")?.({}, ctx);
    const firstResult = (await handler(pi, "session_before_compact")?.(
      {
        branchEntries: branch,
        preparation: {
          firstKeptEntryId: "next",
          messagesToSummarize: [first.message],
          turnPrefixMessages: [],
          isSplitTurn: false,
          tokensBefore: 2_000,
          fileOps: {
            read: new Set(["old-read"]),
            written: new Set(["old-write"]),
            edited: new Set(),
          },
        },
        signal: new AbortController().signal,
      },
      ctx,
    )) as { compaction: { summary: string } };
    branch.push(
      {
        type: "compaction",
        id: "prior",
        fromHook: true,
        ...firstResult.compaction,
      },
      observed("new", "A newly discarded fact", ["next"]),
    );
    const secondResult = (await handler(pi, "session_before_compact")?.(
      {
        branchEntries: branch,
        preparation: {
          firstKeptEntryId: "kept",
          messagesToSummarize: [next.message],
          turnPrefixMessages: [],
          isSplitTurn: false,
          tokensBefore: 2_000,
          previousSummary: firstResult.compaction.summary,
          fileOps: {
            read: new Set(["new-read"]),
            written: new Set(["new-write"]),
            edited: new Set(),
          },
        },
        signal: new AbortController().signal,
      },
      ctx,
    )) as { compaction: { summary: string; details: unknown } };

    expect(
      secondResult.compaction.summary.match(/A recurring batch fact/g),
    ).toHaveLength(1);
    expect(secondResult.compaction.summary).toContain("A newly discarded fact");
    expect(secondResult.compaction.summary).not.toContain(
      "Unrelated retained fact",
    );
    expect(secondResult.compaction.summary.match(/<read-files>/g)).toHaveLength(
      1,
    );
    expect(
      secondResult.compaction.summary.match(/<modified-files>/g),
    ).toHaveLength(1);
    expect(secondResult.compaction.details).toMatchObject({
      readFiles: ["new-read", "old-read"],
      modifiedFiles: ["new-write", "old-write"],
    });
    expect(compact).not.toHaveBeenCalled();
    expect(pi.appendEntry).not.toHaveBeenCalled();
  });

  it.each(["missing cutoff", "split turn", "custom instructions"] as const)(
    "uses model-assisted compaction for a covered prefix with %s",
    async (reason) => {
      const pi = createMockPi();
      const modelCompaction = {
        summary: "model summary",
        firstKeptEntryId: "kept",
        tokensBefore: 2_000,
      };
      const compact = vi.fn().mockResolvedValue(modelCompaction);
      const dir = configDir({ deterministicCompaction: true });
      createMemoryExtension({ getAgentDir: () => dir, compact })(pi as never);
      const observation = observationEntry();
      const covered = messageEntry("m0", "covered");
      const branch = [
        covered,
        { ...observation, data: { ...observation.data, coversUpToId: "m0" } },
        messageEntry("kept", "still visible"),
      ];
      const ctx = createCtx(branch);
      await handler(pi, "session_start")?.({}, ctx);
      const result = await handler(pi, "session_before_compact")?.(
        {
          branchEntries: branch,
          customInstructions:
            reason === "custom instructions" ? "Retain task state" : undefined,
          preparation: {
            ...modelCompaction,
            firstKeptEntryId: reason === "missing cutoff" ? "unknown" : "kept",
            messagesToSummarize: [covered.message],
            turnPrefixMessages: [],
            isSplitTurn: reason === "split turn",
            fileOps: { read: new Set(), written: new Set(), edited: new Set() },
          },
          signal: new AbortController().signal,
        },
        ctx,
      );

      expect(result).toEqual({ compaction: modelCompaction });
      expect(compact).toHaveBeenCalledOnce();
      if (reason === "custom instructions") {
        expect(compact.mock.calls[0]?.[4]).toContain("Retain task state");
      }
    },
  );

  it("cancels opted-in compaction before model lookup when the host already aborted", async () => {
    const pi = createMockPi();
    const compact = vi.fn();
    const dir = configDir({ deterministicCompaction: true });
    createMemoryExtension({ getAgentDir: () => dir, compact })(pi as never);
    const ctx = createCtx([observationEntry()]);
    await handler(pi, "session_start")?.({}, ctx);

    const result = await handler(pi, "session_before_compact")?.(
      { signal: AbortSignal.abort() },
      ctx,
    );

    expect(result).toEqual({ cancel: true });
    expect(ctx.modelRegistry.getApiKeyAndHeaders).not.toHaveBeenCalled();
    expect(compact).not.toHaveBeenCalled();
  });

  it("counts only covered source entries even when a watermark follows a gap", async () => {
    const pi = createMockPi();
    const dir = configDir();
    createMemoryExtension({ getAgentDir: () => dir })(pi as never);

    const observation = observationEntry();
    const ctx = createCtx([
      messageEntry("m0", "uncovered source before the watermark"),
      messageEntry("m1", "covered source"),
      {
        ...observation,
        data: {
          ...observation.data,
          sourceEntryIds: ["m1", "m1", "m3", "other-branch"],
          coversUpToId: "m1",
        },
      },
      messageEntry("m2", "consumed without an observation"),
      {
        type: "custom",
        customType: MEMORY_CONSUMED_TYPE,
        data: { sourceEntryIds: ["m2"] },
      },
      messageEntry("m3", "source after the watermark"),
    ]);
    await handler(pi, "session_start")?.({}, ctx);
    await memoryCommand(pi)?.handler("status", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringMatching(/coverage:[^\n]*\b1\/4\b/),
      "info",
    );
  });

  it("shows memory in a pager", async () => {
    const pi = createMockPi();
    const dir = configDir();
    createMemoryExtension({
      getAgentDir: () => dir,
      observe: vi.fn() as never,
    })(pi as never);

    const ctx = createCtx([observationEntry("Reviewed the diff")]);
    await handler(pi, "session_start")?.({}, ctx);
    await memoryCommand(pi)?.handler("view", ctx);

    expect(pagerMock.show).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        title: "Memory",
        markdown: expect.stringContaining("Reviewed the diff"),
      }),
    );
  });

  it("clears memory and marks the current messages consumed", async () => {
    const pi = createMockPi();
    const dir = configDir();
    createMemoryExtension({
      getAgentDir: () => dir,
      observe: vi.fn() as never,
    })(pi as never);

    const branch = [observationEntry(), messageEntry("m1", "current")];
    const ctx = createCtx(branch);
    await handler(pi, "session_start")?.({}, ctx);
    const command = memoryCommand(pi);

    await command?.handler("clear", ctx);
    expect(ctx.ui.confirm).toHaveBeenCalled();
    expect(pi.appendEntry).toHaveBeenCalledWith(
      MEMORY_CLEAR_TYPE,
      expect.objectContaining({ sourceEntryIds: ["m1"] }),
    );

    await command?.handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("observations: 0/50"),
      "info",
    );
  });

  it("registers nothing under ACP", () => {
    process.env.PI_ACP = "1";
    const pi = createMockPi();
    createMemoryExtension({ getAgentDir: () => configDir() })(pi as never);
    expect(pi.on).not.toHaveBeenCalled();
    expect(pi.registerCommand).not.toHaveBeenCalled();
  });

  it("publishes updateSessionSnapshot and statusline:values on restore, observe, and clear, and answers statusline:request", async () => {
    const pi = createMockPi();
    const dir = configDir();
    const observeMock = vi.fn().mockResolvedValue({
      observations: [{ text: "New observation", relevance: 5 }],
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
    });

    createMemoryExtension({
      getAgentDir: () => dir,
      observe: observeMock as never,
    })(pi as never);

    const branch = [
      observationEntry("Existing observation"),
      messageEntry("m1", "x".repeat(5_000)),
    ];
    const ctx = createCtx(branch);

    // session_start (restore)
    await handler(pi, "session_start")?.({}, ctx);
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "memory",
      text: "1 obs",
    });

    let snap = getSessionSnapshot(ctx.sessionManager).memory;
    expect(snap).toBeDefined();
    expect(snap?.observations).toBe(1);
    expect(snap?.reflections).toBe(0);
    expect(snap?.latestObservation).toBe("Existing observation");

    // statusline:request answers current status
    pi.events.emit.mockClear();
    pi.eventHandlers["statusline:request"]?.({ names: ["memory"] });
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "memory",
      text: "1 obs",
    });

    // agent_settled triggers observation
    await handler(pi, "agent_settled")?.({ aborted: false }, ctx);
    await vi.waitFor(() => {
      expect(observeMock).toHaveBeenCalled();
    });
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "memory",
      text: "2 obs",
    });

    snap = getSessionSnapshot(ctx.sessionManager).memory;
    expect(snap?.observations).toBe(2);
    expect(snap?.latestObservation).toBe("New observation");

    // clearMemory clears snapshot and statusline
    const command = memoryCommand(pi);
    await command?.handler("clear", ctx);

    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "memory",
      text: "",
    });
    snap = getSessionSnapshot(ctx.sessionManager).memory;
    expect(snap?.observations).toBe(0);
    expect(snap?.latestObservation).toBeUndefined();
  });

  it("searches stored observations with the recall tool", async () => {
    const pi = createMockPi();
    const dir = configDir();
    createMemoryExtension({ getAgentDir: () => dir })(pi as never);
    const ctx = createCtx([observationEntry("Prefer pnpm over npm")]);
    await handler(pi, "session_start")?.({}, ctx);

    const tool = memoryTool(pi, "recall");
    const result = await tool?.execute(
      "call-1",
      { query: "pnpm" },
      undefined,
      undefined,
      ctx,
    );

    const payload = JSON.parse(result?.content[0]?.text ?? "{}");
    expect(payload.total).toBe(1);
    expect(payload.results[0]).toEqual(
      expect.objectContaining({
        kind: "observation",
        text: "Prefer pnpm over npm",
      }),
    );
  });

  it("flushes pending observations on /memory checkpoint and before deterministic compaction", async () => {
    const pi = createMockPi();
    const dir = configDir({
      deterministicCompaction: true,
      observeAfterTokens: 50_000,
    });
    const observe = vi.fn().mockResolvedValue({
      observations: [{ text: "Flushed checkpoint observation", relevance: 5 }],
    });
    createMemoryExtension({ getAgentDir: () => dir, observe })(pi as never);
    const branch = [
      messageEntry("m1", "Short message below observeAfterTokens"),
      messageEntry("m2", "Recent kept message"),
    ];
    const compactMock = vi.fn();
    const ctx = {
      ...createCtx(branch),
      compact: compactMock,
    };
    await handler(pi, "session_start")?.({}, ctx);

    const command = memoryCommand(pi);
    await command?.handler("checkpoint", ctx);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(compactMock).toHaveBeenCalledTimes(1);
    expect(pi.appendEntry).toHaveBeenCalledWith(
      MEMORY_OBSERVATION_TYPE,
      expect.objectContaining({
        text: "Flushed checkpoint observation",
        sourceEntryIds: ["m1", "m2"],
      }),
    );
  });

  it("recalls bounded redacted observations from a worktree and scopes the memory commands", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-memory-worktree-"));
    workspaceFixtures.push(cwd);
    writeFileSync(join(cwd, ".git"), "gitdir: /worktrees/example\n");
    const nested = join(cwd, "nested");
    mkdirSync(nested);
    const dir = configDir({ maxObservations: 1 });
    workspaceFixtures.push(dir);

    const writer = createMockPi();
    const observe = vi.fn().mockResolvedValue({
      observations: [
        {
          text: "Workspace fixture pass\x1b[31mword=fixture-only-token",
          relevance: 4,
        },
      ],
    });
    createMemoryExtension({ getAgentDir: () => dir, observe })(writer as never);
    const writerCtx = {
      ...createCtx([messageEntry("m1", "x".repeat(5_000))]),
      cwd: nested,
    };
    const observerCtx = {
      ...writerCtx,
      sessionManager: {
        ...writerCtx.sessionManager,
        getSessionId: () => "session-2",
      },
    };
    await handler(writer, "session_start")?.({}, observerCtx);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1_000);
    try {
      await handler(writer, "agent_settled")?.({ aborted: false }, observerCtx);
      await vi.waitFor(() => {
        expect(writer.appendEntry).toHaveBeenCalledWith(
          MEMORY_OBSERVATION_TYPE,
          expect.objectContaining({
            text: expect.stringContaining("fixture pass"),
          }),
        );
      });
    } finally {
      clock.mockRestore();
    }
    const saved = join(cwd, ".pi", "memory");
    const records = readdirSync(saved).filter((name) => name.endsWith(".json"));
    expect(records).toHaveLength(1);
    for (const record of records) {
      expect(readFileSync(join(saved, record), "utf8")).not.toContain(
        "fixture-only-token",
      );
    }

    const reader = createMockPi();
    createMemoryExtension({ getAgentDir: () => dir })(reader as never);
    const readerCtx = { ...createCtx([]), cwd };
    const recall = memoryTool(reader, "recall");
    const result = await recall?.execute(
      "call-2",
      { query: "workspace", scope: "workspace" },
      undefined,
      undefined,
      readerCtx,
    );
    expect(JSON.parse(result?.content[0]?.text ?? "{}").results).toMatchObject([
      {
        text: "Workspace fixture password=[REDACTED]",
        workspace: cwd,
        sessionOrigin: "session-2",
        redacted: true,
      },
    ]);
    const command = memoryCommand(reader);
    await command?.handler("status", readerCtx);
    expect(readerCtx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("observations: 0/1\nworkspace observations: 1/1"),
      "info",
    );
    await command?.handler("status workspace", readerCtx);
    expect(readerCtx.ui.notify).toHaveBeenLastCalledWith(
      "workspace observations: 1/1",
      "info",
    );
    await command?.handler("view", readerCtx);
    expect(readerCtx.ui.notify).toHaveBeenLastCalledWith(
      "pi-memory: no memory recorded",
      "info",
    );
    await command?.handler("view workspace", readerCtx);
    expect(pagerMock.show).toHaveBeenLastCalledWith(
      readerCtx,
      expect.objectContaining({
        title: "Workspace Memory",
        markdown: expect.stringContaining("password=[REDACTED]"),
      }),
    );
  });

  it("does not let a malformed newer file occupy the workspace retention window", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-memory-invalid-"));
    const dir = configDir({ maxObservations: 1, observeAfterTokens: 1_000 });
    workspaceFixtures.push(cwd, dir);
    mkdirSync(join(cwd, ".pi"));
    let nextText = "valid earlier record";
    const observe = vi.fn().mockImplementation(async () => ({
      observations: [{ text: nextText, relevance: 4 }],
    }));
    const pi = createMockPi();
    createMemoryExtension({ getAgentDir: () => dir, observe })(pi as never);
    const branch = [messageEntry("m1", "x".repeat(5_000))];
    const ctx = { ...createCtx(branch), cwd };
    await handler(pi, "session_start")?.({}, ctx);
    const write = async (text: string, id: string) => {
      nextText = text;
      const writeCtx = {
        ...createCtx([messageEntry(id, "x".repeat(5_000))]),
        cwd,
      };
      await handler(pi, "session_start")?.({}, writeCtx);
      await memoryCommand(pi)?.handler("checkpoint", writeCtx);
    };
    const recall = async () => {
      const result = await memoryTool(pi, "recall")?.execute(
        "call-2",
        { query: "valid", scope: "workspace" },
        undefined,
        undefined,
        ctx,
      );
      return JSON.parse(result?.content[0]?.text ?? "{}").results;
    };
    await write("valid earlier record", "m2");
    writeFileSync(
      join(cwd, ".pi", "memory", `9999999999999999-${"a".repeat(64)}.json`),
      "{}",
    );
    expect(await recall()).toMatchObject([{ text: "valid earlier record" }]);

    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1_000);
    try {
      await write("valid later record", "m3");
    } finally {
      clock.mockRestore();
    }
    expect(await recall()).toMatchObject([{ text: "valid later record" }]);
  });

  it("migrates the saved branch and handles legacy timestamps on retry", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-memory-migrate-"));
    const dir = configDir();
    workspaceFixtures.push(cwd, dir);
    const nested = join(cwd, "nested");
    mkdirSync(join(cwd, ".git"));
    mkdirSync(nested);
    const archive = join(dir, "sessions", "nested-project");
    mkdirSync(archive, { recursive: true });
    const timestamp = "2026-01-01T00:00:00.000Z";
    const header = (id: string, version?: number) => ({
      type: "session",
      id,
      cwd: nested,
      timestamp,
      version,
    });
    const observation = (id: string, text: string) => ({
      ...observationEntry(),
      id,
      data: { id, text },
    });
    const save = (name: string, entries: unknown[]) => {
      const path = join(archive, `${name}.jsonl`);
      writeFileSync(
        path,
        `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
      );
      return path;
    };
    const fork = save("fork", [
      header("fork", 3),
      { ...messageEntry("root", "Choose branch"), parentId: null },
      { ...observation("old", "Discarded branch note"), parentId: "root" },
      { ...observation("selected", "Selected branch note"), parentId: "root" },
    ]);
    const legacy = save("legacy", [
      header("legacy"),
      { ...observationEntry(), data: { id: "legacy", text: "Legacy note" } },
    ]);
    const malformed = save("malformed", [
      header("malformed", 3),
      { ...observation("damaged", "Damaged session note"), parentId: null },
    ]);
    writeFileSync(malformed, '{"type":', { flag: "a" });
    const originals = [fork, legacy, malformed].map((path) =>
      readFileSync(path, "utf8"),
    );
    const pi = createMockPi();
    createMemoryExtension({ getAgentDir: () => dir })(pi as never);
    const ctx = { ...createCtx([]), cwd };
    const command = memoryCommand(pi);
    await command?.handler("migrate", ctx);
    await command?.handler("migrate", ctx);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith(
      "pi-memory: imported 0 workspace observations, skipped 1 unverified session sources",
      "info",
    );
    const result = await memoryTool(pi, "recall")?.execute(
      "call-migrate",
      { query: "note", scope: "workspace" },
      undefined,
      undefined,
      ctx,
    );
    const matches = JSON.parse(result?.content[0]?.text ?? "{}").results;
    expect(matches).toHaveLength(2);
    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "Selected branch note",
          sessionOrigin: "fork",
        }),
        expect.objectContaining({
          text: "Legacy note",
          sessionOrigin: "legacy",
        }),
      ]),
    );
    expect(
      [fork, legacy, malformed].map((path) => readFileSync(path, "utf8")),
    ).toEqual(originals);
  });

  it("traces Pi fork provenance without sharing foreign observations or duplicating local ones", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-memory-migrate-local-"));
    const foreign = mkdtempSync(join(tmpdir(), "pi-memory-migrate-foreign-"));
    const dir = configDir();
    workspaceFixtures.push(cwd, foreign, dir);
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(foreign, ".git"));
    const localDir = join(dir, "sessions", "local");
    const saveSession = (
      path: string,
      archive: string,
      id: string,
      text: string,
    ) => {
      const session = SessionManager.create(path, archive, { id });
      session.appendMessage({
        role: "user",
        content: "Start test session",
        timestamp: Date.now(),
      });
      session.appendCustomEntry(MEMORY_OBSERVATION_TYPE, {
        ...observationEntry(text).data,
        id,
      });
      const source = session.getSessionFile();
      if (!source) throw new Error("Missing saved test session");
      return source;
    };
    const foreignFile = saveSession(
      foreign,
      join(dir, "sessions", "foreign"),
      "foreign-source",
      "Foreign note",
    );
    const relocated = SessionManager.forkFrom(foreignFile, cwd, localDir, {
      id: "relocated",
    });
    relocated.appendCustomEntry(MEMORY_OBSERVATION_TYPE, {
      ...observationEntry("Locally authored note").data,
      id: "local-obs",
    });
    const localFile = saveSession(
      cwd,
      localDir,
      "local-source",
      "Original local note",
    );
    SessionManager.forkFrom(localFile, cwd, localDir, { id: "local-fork" });
    const pi = createMockPi();
    createMemoryExtension({ getAgentDir: () => dir })(pi as never);
    const ctx = { ...createCtx([]), cwd };
    const command = memoryCommand(pi);
    await command?.handler("migrate", ctx);
    await command?.handler("migrate", ctx);
    const result = await memoryTool(pi, "recall")?.execute(
      "call-migrate",
      { query: "note", scope: "workspace" },
      undefined,
      undefined,
      ctx,
    );
    const matches = JSON.parse(result?.content[0]?.text ?? "{}").results;
    expect(matches).toHaveLength(2);
    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "Locally authored note",
          sessionOrigin: "relocated",
        }),
        expect.objectContaining({
          text: "Original local note",
          sessionOrigin: "local-source",
        }),
      ]),
    );
  });

  it("uses only the live branch when session directory aliases reach the same archive", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-memory-migrate-alias-"));
    const dir = configDir();
    workspaceFixtures.push(cwd, dir);
    mkdirSync(join(cwd, ".git"));
    const archive = join(dir, "sessions", "local");
    const session = SessionManager.create(cwd, archive, { id: "live" });
    const root = session.appendMessage({
      role: "user",
      content: "Start test session",
      timestamp: Date.now(),
    });
    const selected = session.appendCustomEntry(
      MEMORY_OBSERVATION_TYPE,
      observationEntry("Selected note").data,
    );
    session.branch(root);
    session.appendCustomEntry(MEMORY_OBSERVATION_TYPE, {
      ...observationEntry("Inactive saved note").data,
      id: "inactive",
    });
    const file = session.getSessionFile();
    if (!file) throw new Error("Missing saved test session");
    const alias = join(dir, "alias");
    symlinkSync(archive, alias, "dir");
    const opened = SessionManager.open(join(alias, basename(file)), alias);
    opened.branch(selected);

    const pi = createMockPi();
    createMemoryExtension({ getAgentDir: () => dir })(pi as never);
    const ctx = { ...createCtx([]), cwd, sessionManager: opened };
    await memoryCommand(pi)?.handler("migrate", ctx);
    const result = await memoryTool(pi, "recall")?.execute(
      "call-migrate",
      { query: "note", scope: "workspace" },
      undefined,
      undefined,
      ctx,
    );
    expect(JSON.parse(result?.content[0]?.text ?? "{}").results).toMatchObject([
      { text: "Selected note", sessionOrigin: "live" },
    ]);
  });

  it("completes /memory subcommands and scope arguments", () => {
    const pi = createMockPi();
    createMemoryExtension({ getAgentDir: () => configDir() })(pi as never);
    const command = memoryCommand(pi);

    expect(
      command?.getArgumentCompletions?.("")?.map((item) => item.value),
    ).toEqual(["status", "view", "checkpoint", "clear", "handoff", "migrate"]);
    expect(
      command?.getArgumentCompletions?.("st")?.map((item) => item.value),
    ).toEqual(["status"]);
    expect(command?.getArgumentCompletions?.("status ")).toEqual([
      { value: "status session", label: "session" },
      { value: "status workspace", label: "workspace" },
    ]);
    expect(command?.getArgumentCompletions?.("view w")).toEqual([
      { value: "view workspace", label: "workspace" },
    ]);
  });

  it("keeps statusline subscription alive across session_shutdown and subsequent session_start", async () => {
    const listeners = new Map<string, Set<(data: unknown) => void>>();
    const pi = createMockPi();
    pi.events.on.mockImplementation(
      (event: string, fn: (data: unknown) => void) => {
        let set = listeners.get(event);
        if (!set) {
          set = new Set();
          listeners.set(event, set);
        }
        set.add(fn);
        return () => {
          set?.delete(fn);
        };
      },
    );
    pi.events.emit.mockImplementation((event: string, data: unknown) => {
      for (const fn of listeners.get(event) ?? []) {
        fn(data);
      }
    });

    const dir = configDir();
    createMemoryExtension({ getAgentDir: () => dir })(pi as never);

    const ctx1 = createCtx([observationEntry("First obs")]);
    await handler(pi, "session_start")?.({}, ctx1);
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "memory",
      text: "1 obs",
    });

    pi.events.emit.mockClear();
    await handler(pi, "session_shutdown")?.({}, ctx1);
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "memory",
      text: "",
    });

    const ctx2 = createCtx([observationEntry("Second obs")]);
    pi.events.emit.mockClear();
    await handler(pi, "session_start")?.({}, ctx2);
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "memory",
      text: "1 obs",
    });

    pi.events.emit.mockClear();
    pi.events.emit("statusline:request", { names: ["memory"] });
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "memory",
      text: "1 obs",
    });
  });
});
