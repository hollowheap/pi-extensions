import { setSessionUsage } from "@hollowheap/core/usage";
import { describe, expect, it, vi } from "vitest";
import extension, { formatUsageReport } from "../src/index.js";

describe("dollar cap display", () => {
  it("shows used and cap as dollar amounts under the budget line", () => {
    const report = formatUsageReport({
      inputTokens: 100,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 100,
      totalCost: 2.5,
      budgetCap: 5,
      byModel: {},
    });

    expect(report).toMatch(/Budget [█░]{16} \$2\.50 \/ \$5\.00/);
  });

  it("an uncapped report omits the budget line", () => {
    const report = formatUsageReport({
      inputTokens: 100,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 100,
      totalCost: 2.5,
      byModel: {},
    });
    expect(report).not.toContain("Budget ");
  });

  it("a breached threshold adds a warning line", () => {
    const report = formatUsageReport({
      inputTokens: 100,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 100,
      totalCost: 4.5,
      budgetCap: 5,
      budgetWarning: true,
      byModel: {},
    });
    expect(report).toContain("⚠ Budget warning: 4.50 / 5.00");
  });

  it("the statusline provider publishes used over cap", () => {
    const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
    const listeners: Record<string, (data: unknown) => void> = {};
    const emitted: Array<{ name: string; text: string }> = [];
    const pi = {
      on: vi.fn(
        (event: string, handler: (event: unknown, ctx: unknown) => void) => {
          handlers[event] = handler;
          return () => {};
        },
      ),
      events: {
        on: vi.fn((event: string, handler: (data: unknown) => void) => {
          listeners[event] = handler;
          return () => {};
        }),
        emit: vi.fn((event: string, data: unknown) => {
          if (event === "statusline:values") {
            emitted.push(data as { name: string; text: string });
          }
        }),
      },
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
    };
    extension(pi as never);

    const cappedUsage = {
      inputTokens: 100,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 100,
      totalCost: 2.5,
      budgetCap: 5,
      byModel: {},
    };
    const sessionManager = {
      getBranch: () => [{ customType: "hollowheap.usage", data: cappedUsage }],
    };
    setSessionUsage(sessionManager, cappedUsage);
    handlers.session_start?.(
      {},
      { sessionManager, cwd: "/repo", hasUI: true, ui: { notify: vi.fn() } },
    );
    listeners["statusline:request"]?.({ names: ["usage"] });

    expect(emitted).toContainEqual({ name: "usage", text: "$2.50/$5.00" });
  });
});
