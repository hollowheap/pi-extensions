import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { USAGE_ENTRY_TYPE } from "@hollowheap/core/usage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMORY_CONFIG_FILE } from "./config.js";
import { createMemoryExtension } from "./index.js";
import {
  MEMORY_CLEAR_TYPE,
  MEMORY_CONSUMED_TYPE,
  MEMORY_OBSERVATION_TYPE,
} from "./ledger.js";

const pagerMock = vi.hoisted(() => ({ show: vi.fn() }));

vi.mock("@hollowheap/tui/pager", () => ({
  showMarkdownPager: pagerMock.show,
}));

function createMockPi() {
  return {
    on: vi.fn(),
    registerCommand: vi.fn(),
    appendEntry: vi.fn(),
    events: { emit: vi.fn(), on: vi.fn() },
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
    | { handler: (args: string, ctx: unknown) => Promise<void> }
    | undefined;
}

afterEach(() => {
  Reflect.deleteProperty(process.env, "PI_ACP");
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
        }),
      );
    });
    expect(pi.appendEntry).toHaveBeenCalledWith(
      USAGE_ENTRY_TYPE,
      expect.objectContaining({
        byModel: expect.objectContaining({
          "memory-model": expect.objectContaining({ inputTokens: 10 }),
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

  it("injects memory into compaction", async () => {
    const pi = createMockPi();
    const compact = vi.fn().mockResolvedValue({
      summary: "summary with memory",
      firstKeptEntryId: "m0",
      tokensBefore: 100,
    });
    const dir = configDir();
    createMemoryExtension({
      getAgentDir: () => dir,
      observe: vi.fn() as never,
      compact: compact as never,
    })(pi as never);

    const branch = [observationEntry()];
    const ctx = createCtx(branch);
    await handler(pi, "session_start")?.({}, ctx);

    const result = await handler(pi, "session_before_compact")?.(
      {
        preparation: { firstKeptEntryId: "m0" },
        customInstructions: "focus on tests",
        signal: new AbortController().signal,
      },
      ctx,
    );

    expect(result).toEqual({
      compaction: {
        summary: "summary with memory",
        firstKeptEntryId: "m0",
        tokensBefore: 100,
      },
    });
    expect(compact).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "main-model" }),
      "key",
      { x: "y" },
      expect.stringContaining("focus on tests"),
      expect.any(AbortSignal),
    );
    expect(compact.mock.calls[0]?.[4]).toContain("Prefer small commits");
    expect(compact.mock.calls[0]?.[4]).toContain("focus on tests");
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
});
