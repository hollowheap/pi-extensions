import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import extension, {
  USAGE_ENTRY_TYPE,
  extractLatestUsage,
  formatUsageReport,
  getSessionUsage,
  recordTurnUsage,
} from "./index.js";
import { combineUsage, scanSubagentUsage } from "./subagents.js";

const mockState = vi.hoisted(() => ({
  agentDir: "/nonexistent-pi-agent-dir-for-tests",
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => mockState.agentDir,
}));

const tempDirs: string[] = [];

afterEach(() => {
  mockState.agentDir = "/nonexistent-pi-agent-dir-for-tests";
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createSubagentState(
  dir: string,
  id: string,
  parentSession: string,
  harness = "pi",
): { statePath: string; sessionPath: string } {
  const subagents = join(dir, "subagents");
  mkdirSync(subagents, { recursive: true });
  const sessionPath = join(subagents, `${id}.session.jsonl`);
  writeFileSync(
    join(subagents, `${id}.json`),
    JSON.stringify({
      id,
      parentSession,
      status: "completed",
      agent: "scout",
      model: "claude-3-5-sonnet",
      harness,
      session: sessionPath,
      startedAt: 1,
    }),
  );
  return { statePath: join(subagents, `${id}.json`), sessionPath };
}

function createMockPi() {
  const eventHandlers: Record<string, (data: unknown) => void> = {};
  return {
    on: vi.fn(
      (_event: string, _fn: (event: never, ctx: never) => unknown) => () => {},
    ),
    registerCommand: vi.fn(),
    events: {
      on: vi.fn((event: string, fn: (data: unknown) => void) => {
        eventHandlers[event] = fn;
        return () => {};
      }),
      emit: vi.fn(),
    },
    eventHandlers,
  };
}

function setupUsageExtension() {
  const pi = createMockPi();
  extension(pi as never);

  const customEntries: Array<{ customType: string; data?: unknown }> = [];
  const sessionManager = {
    getSessionId: () => "session-1",
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
    abort: vi.fn(),
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
    eventHandlers: pi.eventHandlers,
    sessionStart: () => handlers.session_start({} as never, ctx as never),
    sessionTree: () => handlers.session_tree({} as never, ctx as never),
    sessionShutdown: () => handlers.session_shutdown({} as never, ctx as never),
    beforeAgentStart: () =>
      handlers.before_agent_start({} as never, ctx as never),
    messageEnd: (
      usage?: {
        input: number;
        output: number;
        cacheRead?: number;
        cacheWrite?: number;
        cost?: { total?: number };
      },
      model?: string,
    ) =>
      handlers.message_end(
        {
          message: {
            role: "assistant",
            usage,
            ...(model !== undefined ? { model } : {}),
          },
        } as never,
        ctx as never,
      ),
    runUsage: (args = "") => commands.usage.handler(args, ctx as never),
  };
}

describe("extractLatestUsage", () => {
  it("returns zero counts for empty entries", () => {
    expect(extractLatestUsage([])).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      byModel: {},
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
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 700,
      totalCost: 0.25,
      byModel: {},
    });
  });

  it("restores budget warning and validates by-model data", () => {
    const entries = [
      {
        customType: USAGE_ENTRY_TYPE,
        data: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 10,
          cacheWriteTokens: 5,
          totalTokens: 999,
          totalCost: 0.1,
          budgetCap: 1,
          budgetWarning: true,
          byModel: {
            good: {
              model: "good",
              inputTokens: 100,
              outputTokens: 50,
              cacheReadTokens: 10,
              cacheWriteTokens: 5,
              cost: 0.1,
            },
            bad: {
              model: "bad",
              inputTokens: -1,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              cost: 0,
            },
          },
        },
      },
    ];
    expect(extractLatestUsage(entries)).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      totalTokens: 165,
      totalCost: 0.1,
      byModel: {
        good: {
          model: "good",
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 10,
          cacheWriteTokens: 5,
          cost: 0.1,
        },
      },
      budgetCap: 1,
      budgetWarning: true,
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
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      byModel: {},
    });
  });
});

describe("recordTurnUsage", () => {
  it("accumulates tokens and cost monotonically", () => {
    const initial = {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 150,
      totalCost: 0.1,
      byModel: {},
    };
    const next = recordTurnUsage(initial, { input: 40, output: 60 }, 0.05);
    expect(next).toEqual({
      inputTokens: 140,
      outputTokens: 110,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 250,
      totalCost: 0.15,
      byModel: {
        unknown: {
          model: "unknown",
          inputTokens: 40,
          outputTokens: 60,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cost: 0.05,
        },
      },
    });
  });

  it("counts cache tokens in totals and does not round accumulated costs", () => {
    const initial = {
      inputTokens: 10,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 20,
      totalCost: 0.1,
      byModel: {},
    };
    const next = recordTurnUsage(
      initial,
      { input: 100, output: 50, cacheRead: 20, cacheWrite: 10 },
      0.0000001,
      "model",
    );
    expect(next.totalTokens).toBe(200);
    expect(next.totalCost).toBe(0.1000001);
    expect(next.byModel.model).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheWriteTokens: 10,
      cost: 0.0000001,
    });
  });

  it("guards against negative deltas", () => {
    const initial = {
      inputTokens: 10,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 20,
      totalCost: 0.05,
      byModel: {},
    };
    const next = recordTurnUsage(initial, { input: -5, output: -10 }, -0.01);
    expect(next).toEqual(initial);
  });
});

describe("subagent usage", () => {
  it("scans current-parent child sessions and rolls usable rows into totals", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-usage-scan-"));
    tempDirs.push(dir);
    const first = createSubagentState(dir, "sub-1", "session-1");
    writeFileSync(
      first.sessionPath,
      `${JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          model: "claude-3-5-sonnet",
          usage: {
            input: 1_000_000,
            output: 1_000_000,
            cacheRead: 0,
            cacheWrite: 0,
            cost: { total: 18 },
          },
        },
      })}\n`,
    );
    createSubagentState(dir, "sub-other-parent", "session-2");
    createSubagentState(dir, "sub-generic", "session-1", "claude");
    const custom = createSubagentState(dir, "sub-custom", "session-1");
    writeFileSync(
      custom.sessionPath,
      `${JSON.stringify({
        type: "custom",
        customType: USAGE_ENTRY_TYPE,
        data: {
          inputTokens: 10,
          outputTokens: 5,
          totalCost: 0.5,
          byModel: {},
        },
      })}\n${JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 999, output: 999, cost: { total: 99 } },
        },
      })}\n`,
    );
    writeFileSync(join(dir, "subagents", "bad.json"), "{");

    const rows = scanSubagentUsage(dir, "session-1");
    expect(rows).toHaveLength(3);
    const piRow = rows.find((row) => row.id === "sub-1");
    expect(piRow).toMatchObject({
      available: true,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      totalTokens: 2_000_000,
      cost: 18,
    });
    expect(rows.find((row) => row.id === "sub-generic")?.available).toBe(false);
    expect(rows.find((row) => row.id === "sub-custom")).toMatchObject({
      available: true,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cost: 0.5,
    });

    const combined = combineUsage(
      {
        inputTokens: 10,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 20,
        totalCost: 0.1,
        byModel: {},
      },
      rows,
    );
    expect(combined.totalTokens).toBe(2_000_035);
    expect(combined.totalCost).toBe(18.6);
    expect(combined.byModel["claude-3-5-sonnet"]?.cost).toBe(18.5);

    const report = formatUsageReport(combined, rows);
    expect(report).toContain("@sub-1 (scout)");
    expect(report).toContain(
      "@sub-generic (scout) [completed]: usage unavailable",
    );
  });

  it("includes current-parent subagent usage in the /usage report", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-usage-report-"));
    tempDirs.push(dir);
    mockState.agentDir = dir;
    const fixture = createSubagentState(dir, "sub-1", "session-1");
    writeFileSync(
      fixture.sessionPath,
      `${JSON.stringify({
        type: "usage",
        model: "claude-3-5-sonnet",
        usage: {
          input: 100,
          output: 50,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { total: 0.01 },
        },
      })}\n`,
    );
    const env = setupUsageExtension();
    env.sessionStart();
    await env.runUsage();
    expect(env.ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("@sub-1 (scout)"),
    );
  });

  it("subagent turns with cost.total === 0 use price table and positive provider cost is kept", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-usage-sub-"));
    tempDirs.push(dir);
    const subZero = createSubagentState(dir, "sub-zero", "session-1");
    writeFileSync(
      subZero.sessionPath,
      `${JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          model: "claude-3-5-sonnet",
          usage: {
            input: 1_000_000,
            output: 1_000_000,
            cacheRead: 0,
            cacheWrite: 0,
            cost: { total: 0 },
          },
        },
      })}\n`,
    );
    const subProvider = createSubagentState(dir, "sub-prov", "session-1");
    writeFileSync(
      subProvider.sessionPath,
      `${JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          model: "claude-3-5-sonnet",
          usage: {
            input: 1_000_000,
            output: 1_000_000,
            cacheRead: 0,
            cacheWrite: 0,
            cost: { total: 25.5 },
          },
        },
      })}\n`,
    );
    const rows = scanSubagentUsage(dir, "session-1");
    const zeroRow = rows.find((r) => r.id === "sub-zero");
    const provRow = rows.find((r) => r.id === "sub-prov");
    expect(zeroRow?.cost).toBe(18);
    expect(provRow?.cost).toBe(25.5);
  });
});

describe("formatUsageReport", () => {
  it("formats tokens and dollar amount", () => {
    const text = formatUsageReport({
      inputTokens: 1200,
      outputTokens: 800,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2000,
      totalCost: 0.05,
      byModel: {},
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

  it("uses the message model for pricing instead of a switched ctx model", () => {
    const env = setupUsageExtension();
    env.sessionStart();
    env.ctx.model = {
      id: "different-model",
      cost: { input: 100, output: 100 },
    } as never;
    env.messageEnd(
      { input: 1_000_000, output: 1_000_000 },
      "claude-3-5-sonnet",
    );
    expect(getSessionUsage(env.ctx.sessionManager).totalCost).toBe(18);
  });

  it("keeps positive provider cost and falls back to price table when cost.total is 0", () => {
    const env = setupUsageExtension();
    env.sessionStart();

    // Turn with positive provider cost keeps that value
    env.messageEnd({
      input: 1_000_000,
      output: 500_000,
      cost: { total: 5.5 },
    });
    expect(getSessionUsage(env.ctx.sessionManager).totalCost).toBe(5.5);

    // Turn with cost.total === 0 falls back to price-table cost (1M * 2 + 0.5M * 8 = 6.0 => 5.5 + 6.0 = 11.5)
    env.messageEnd({
      input: 1_000_000,
      output: 500_000,
      cost: { total: 0 },
    });
    expect(getSessionUsage(env.ctx.sessionManager).totalCost).toBe(11.5);
  });

  it("does not overwrite usage when the session manager lacks branch accessors", () => {
    const env = setupUsageExtension();
    env.sessionStart();
    env.messageEnd({ input: 100, output: 100 });
    const before = getSessionUsage(env.ctx.sessionManager);
    Reflect.deleteProperty(env.sessionManager, "getEntries");
    env.sessionStart();
    expect(getSessionUsage(env.ctx.sessionManager)).toEqual(before);
  });

  it("sets and clears a dollar budget cap", async () => {
    const env = setupUsageExtension();
    env.sessionStart();
    await env.runUsage("cap $5");
    expect(getSessionUsage(env.ctx.sessionManager).budgetCap).toBe(5);
    expect(env.ctx.ui.notify).toHaveBeenLastCalledWith(
      "pi-usage: budget cap $5.00",
      "info",
    );

    await env.runUsage("cap off");
    expect(getSessionUsage(env.ctx.sessionManager).budgetCap).toBeUndefined();
    expect(env.ctx.ui.notify).toHaveBeenLastCalledWith(
      "pi-usage: budget cap cleared",
    );
  });

  it("warns at the soft threshold and aborts at the cap", async () => {
    const env = setupUsageExtension();
    env.sessionStart();
    await env.runUsage("cap $1");
    env.messageEnd({ input: 500_000, output: 0 });
    expect(getSessionUsage(env.ctx.sessionManager).budgetWarning).toBe(true);
    expect(env.ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("budget warning (1.00 / 1.00)"),
      "warning",
    );

    env.beforeAgentStart();
    expect(env.ctx.abort).toHaveBeenCalledTimes(1);
    expect(env.ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("budget cap reached"),
      "error",
    );
  });

  it("publishes the cap to the statusline provider", async () => {
    const env = setupUsageExtension();
    env.sessionStart();
    expect(env.pi.events.emit).toHaveBeenLastCalledWith("statusline:values", {
      name: "usage",
      text: "",
    });

    await env.runUsage("cap $5");
    expect(env.pi.events.emit).toHaveBeenLastCalledWith("statusline:values", {
      name: "usage",
      text: "$0.00/$5.00",
    });

    env.eventHandlers["statusline:request"]?.({ names: ["usage"] });
    expect(env.pi.events.emit).toHaveBeenLastCalledWith("statusline:values", {
      name: "usage",
      text: "$0.00/$5.00",
    });

    env.sessionShutdown();
    expect(env.pi.events.emit).toHaveBeenLastCalledWith("statusline:values", {
      name: "usage",
      text: "",
    });
  });

  it("includes subagent spend in the cap check", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-usage-cap-"));
    tempDirs.push(dir);
    mockState.agentDir = dir;
    const fixture = createSubagentState(dir, "sub-1", "session-1");
    writeFileSync(
      fixture.sessionPath,
      `${JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          model: "claude-3-5-sonnet",
          usage: {
            input: 1_000_000,
            output: 1_000_000,
            cost: { total: 18 },
          },
        },
      })}\n`,
    );
    const env = setupUsageExtension();
    env.sessionStart();
    await env.runUsage("cap $10");
    env.beforeAgentStart();
    expect(env.ctx.abort).toHaveBeenCalledTimes(1);
    expect(env.ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("budget cap reached (18.00 / 10.00)"),
      "error",
    );
  });

  it("refreshes statusline usage when a subagent leaves the active set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-usage-refresh-"));
    tempDirs.push(dir);
    mockState.agentDir = dir;
    const env = setupUsageExtension();
    env.sessionStart();
    await env.runUsage("cap $10");

    const fixture = createSubagentState(dir, "sub-1", "session-1");
    writeFileSync(
      fixture.sessionPath,
      `${JSON.stringify({
        type: "usage",
        model: "claude-3-5-sonnet",
        usage: {
          input: 1_000_000,
          output: 1_000_000,
          cost: { total: 18 },
        },
      })}\n`,
    );
    env.eventHandlers["subagents:state"]?.([{ id: "sub-1" }]);
    env.eventHandlers["subagents:state"]?.([]);
    expect(env.pi.events.emit).toHaveBeenLastCalledWith("statusline:values", {
      name: "usage",
      text: "$18.00/$10.00",
    });
  });

  it("refreshes persisted usage when another extension records spend", () => {
    const setup = setupUsageExtension();
    setup.sessionStart();

    const next = recordTurnUsage(
      getSessionUsage(setup.sessionManager),
      { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 },
      0.01,
      "memory-model",
    );
    setup.customEntries.push({ customType: USAGE_ENTRY_TYPE, data: next });
    setup.eventHandlers["usage:refresh"]?.(undefined);

    expect(
      getSessionUsage(setup.sessionManager).byModel["memory-model"]
        ?.inputTokens,
    ).toBe(100);
    expect(setup.pi.events.emit).toHaveBeenCalledWith(
      "statusline:values",
      expect.objectContaining({ name: "usage" }),
    );
  });

  it("restores persisted subagent attribution when child files are gone", async () => {
    const env = setupUsageExtension();
    env.customEntries.push({
      customType: USAGE_ENTRY_TYPE,
      data: {
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0,
        subagents: [
          {
            id: "persisted-sub",
            agent: "scout",
            model: "claude-3-5-sonnet",
            status: "completed",
            available: true,
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 150,
            cost: 0.01,
            byModel: {},
          },
        ],
      },
    });
    env.sessionStart();
    await env.runUsage();
    expect(env.ctx.ui.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("@persisted-sub (scout)"),
    );
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

  it("restores the active branch usage on session_tree when two branches exist", () => {
    const env = setupUsageExtension();
    const branchA = [
      {
        customType: USAGE_ENTRY_TYPE,
        data: {
          inputTokens: 1_000,
          outputTokens: 500,
          totalCost: 0.5,
        },
      },
    ];
    const branchB = [
      {
        customType: USAGE_ENTRY_TYPE,
        data: {
          inputTokens: 200,
          outputTokens: 100,
          totalCost: 0.1,
        },
      },
    ];
    env.customEntries.push(...branchA, ...branchB);
    (
      env.sessionManager as {
        getBranch?: () => readonly unknown[];
      }
    ).getBranch = vi.fn(() => branchA);

    env.sessionTree();
    expect(getSessionUsage(env.ctx.sessionManager).totalCost).toBe(0.5);
    expect(env.sessionManager.getEntries).not.toHaveBeenCalled();
  });
});
