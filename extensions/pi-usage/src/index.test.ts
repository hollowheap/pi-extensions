import { describe, expect, it, vi } from "vitest";
import extension, {
  USAGE_ENTRY_TYPE,
  extractLatestUsage,
  formatUsageReport,
  getSessionUsage,
  recordTurnUsage,
} from "./index.js";

function createMockPi() {
  return {
    on: vi.fn(
      (_event: string, _fn: (event: never, ctx: never) => unknown) => () => {},
    ),
    registerCommand: vi.fn(),
  };
}

function setupUsageExtension() {
  const pi = createMockPi();
  extension(pi as never);

  const customEntries: Array<{ customType: string; data?: unknown }> = [];
  const sessionManager = {
    getEntries: vi.fn(() => customEntries),
    appendCustomEntry: vi.fn((customType: string, data?: unknown) => {
      customEntries.push({ customType, data });
    }),
  };

  const ctx = {
    sessionManager,
    hasUI: true,
    model: {
      id: "test-model",
      cost: { input: 2.0, output: 8.0 },
    },
    ui: {
      notify: vi.fn(),
    },
  };

  const handlers = Object.fromEntries(
    pi.on.mock.calls.map(([event, fn]) => [event, fn]),
  );
  const commands = Object.fromEntries(
    pi.registerCommand.mock.calls.map(([name, def]) => [name, def]),
  );

  return {
    pi,
    ctx,
    sessionManager,
    customEntries,
    handlers,
    commands,
    sessionStart: () => handlers.session_start({} as never, ctx as never),
    sessionTree: () => handlers.session_tree({} as never, ctx as never),
    sessionShutdown: () => handlers.session_shutdown({} as never, ctx as never),
    messageEnd: (usage?: { input: number; output: number }) =>
      handlers.message_end(
        {
          message: {
            role: "assistant",
            usage,
          },
        } as never,
        ctx as never,
      ),
    runUsage: () => commands.usage.handler("", ctx as never),
  };
}

describe("extractLatestUsage", () => {
  it("returns zero counts for empty entries", () => {
    expect(extractLatestUsage([])).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
    });
  });

  it("extracts the latest hollowheap.usage entry", () => {
    const entries = [
      {
        customType: USAGE_ENTRY_TYPE,
        data: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          totalCost: 0.05,
        },
      },
      {
        customType: "other.entry",
        data: { foo: "bar" },
      },
      {
        customType: USAGE_ENTRY_TYPE,
        data: {
          inputTokens: 500,
          outputTokens: 200,
          totalTokens: 700,
          totalCost: 0.25,
        },
      },
    ];
    expect(extractLatestUsage(entries)).toEqual({
      inputTokens: 500,
      outputTokens: 200,
      totalTokens: 700,
      totalCost: 0.25,
    });
  });

  it("safely ignores malformed custom entries", () => {
    const entries = [
      null,
      { customType: USAGE_ENTRY_TYPE, data: "invalid" },
      { customType: USAGE_ENTRY_TYPE, data: { inputTokens: "bad" } },
    ];
    expect(extractLatestUsage(entries)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
    });
  });
});

describe("recordTurnUsage", () => {
  it("accumulates tokens and cost monotonically", () => {
    const initial = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      totalCost: 0.1,
    };
    const next = recordTurnUsage(initial, { input: 40, output: 60 }, 0.05);
    expect(next).toEqual({
      inputTokens: 140,
      outputTokens: 110,
      totalTokens: 250,
      totalCost: 0.15,
    });
  });

  it("guards against negative deltas", () => {
    const initial = {
      inputTokens: 10,
      outputTokens: 10,
      totalTokens: 20,
      totalCost: 0.05,
    };
    const next = recordTurnUsage(initial, { input: -5, output: -10 }, -0.01);
    expect(next).toEqual(initial);
  });
});

describe("formatUsageReport", () => {
  it("formats tokens and dollar amount", () => {
    const text = formatUsageReport({
      inputTokens: 1200,
      outputTokens: 800,
      totalTokens: 2000,
      totalCost: 0.05,
    });
    expect(text).toContain("2,000 tokens");
    expect(text).toContain("1,200 in, 800 out");
    expect(text).toContain("$0.05");
  });
});

describe("pi-usage extension lifecycle", () => {
  it("records assistant usage into custom entries", () => {
    const env = setupUsageExtension();
    env.sessionStart();
    expect(getSessionUsage(env.ctx.sessionManager).totalTokens).toBe(0);

    env.messageEnd({ input: 1_000_000, output: 500_000 });
    // Cost: 1M * $2.0 + 0.5M * $8.0 = $2.0 + $4.0 = $6.0
    expect(env.sessionManager.appendCustomEntry).toHaveBeenCalledWith(
      USAGE_ENTRY_TYPE,
      expect.objectContaining({
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        totalTokens: 1_500_000,
        totalCost: 6.0,
      }),
    );
  });

  it("survives compaction by restoring from custom entries", () => {
    const env = setupUsageExtension();
    // Simulate pre-existing compacted history
    env.customEntries.push({
      customType: USAGE_ENTRY_TYPE,
      data: {
        inputTokens: 2_000_000,
        outputTokens: 1_000_000,
        totalTokens: 3_000_000,
        totalCost: 12.0,
      },
    });

    env.sessionStart();
    const restored = getSessionUsage(env.ctx.sessionManager);
    expect(restored.totalTokens).toBe(3_000_000);
    expect(restored.totalCost).toBe(12.0);

    // Another turn accumulates on top of compacted baseline
    env.messageEnd({ input: 100_000, output: 50_000 });
    expect(getSessionUsage(env.ctx.sessionManager).totalTokens).toBe(3_150_000);
  });

  it("registers /usage command and outputs report", () => {
    const env = setupUsageExtension();
    env.sessionStart();
    env.runUsage();
    expect(env.ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Cumulative session usage: 0 tokens"),
    );
  });

  it("cleans up session tracking on shutdown", () => {
    const env = setupUsageExtension();
    env.sessionStart();
    env.messageEnd({ input: 100, output: 100 });
    expect(getSessionUsage(env.ctx.sessionManager).totalTokens).toBe(200);

    env.sessionShutdown();
    expect(getSessionUsage(env.ctx.sessionManager).totalTokens).toBe(0);
  });
});
