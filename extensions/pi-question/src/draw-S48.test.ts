import { describe, expect, it, vi } from "vitest";
import { createQuestionTool } from "./index.js";

vi.mock("./alerts.js", () => ({ alertQuestion: vi.fn() }));
vi.mock("@hollowheap/core/prompt-lock", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, withPromptLock: vi.fn((fn: () => unknown) => fn()) };
});

function mockPi() {
  return {
    on: vi.fn(() => () => {}),
    registerTool: vi.fn(),
    appendEntry: vi.fn(),
    getActiveTools: vi.fn(() => []),
    getAllTools: vi.fn(() => []),
    setActiveTools: vi.fn(),
  };
}

describe("S48: cancelling a dialog cancels the set with no follow-up", () => {
  it("does not throw and emits no answers entry when the dialog is cancelled", async () => {
    const pi = mockPi();
    const tool = createQuestionTool(pi as never);
    const ctx = {
      hasUI: true,
      mode: "tui",
      ui: {
        select: vi.fn().mockResolvedValue(undefined),
        input: vi.fn(),
        custom: vi.fn(),
      },
    };

    await expect(
      tool.execute(
        "call-1",
        { prompt: "Cancel me", options: ["Option A"] },
        undefined,
        undefined,
        ctx as never,
      ),
    ).resolves.toBeDefined();
    expect(pi.appendEntry).not.toHaveBeenCalled();
  });
});

describe("write-in, abort, and message seams", () => {
  it("S48 C02: cancelling the write-in input emits no answers entry", async () => {
    const pi = mockPi();
    const tool = createQuestionTool(pi as never);
    const ctx = {
      hasUI: true,
      mode: "rpc",
      ui: {
        select: vi.fn().mockResolvedValue("Write-in answer"),
        input: vi.fn().mockResolvedValue(undefined),
        custom: vi.fn(),
      },
    };
    const result = (await tool.execute(
      "c2",
      { prompt: "Cancel me", options: ["Option A"] },
      undefined,
      undefined,
      ctx as never,
    )) as { details: { cancelled: boolean } };
    expect(result.details.cancelled).toBe(true);
    expect(pi.appendEntry).not.toHaveBeenCalled();
  });

  it("S48 C03: an aborted signal cancels without emitting an entry", async () => {
    const pi = mockPi();
    const tool = createQuestionTool(pi as never);
    const controller = new AbortController();
    const ctx = {
      hasUI: true,
      mode: "rpc",
      ui: {
        select: vi
          .fn()
          .mockRejectedValue(new DOMException("aborted", "AbortError")),
        input: vi.fn(),
        custom: vi.fn(),
      },
    };
    const result = (await tool.execute(
      "c3",
      { prompt: "Cancel me", options: ["Option A"] },
      controller.signal,
      undefined,
      ctx as never,
    )) as { details: { cancelled: boolean } };
    expect(result.details.cancelled).toBe(true);
    expect(pi.appendEntry).not.toHaveBeenCalled();
  });

  it("S48 C04: cancellation reports the cancellation message", async () => {
    const pi = mockPi();
    const tool = createQuestionTool(pi as never);
    const ctx = {
      hasUI: true,
      mode: "tui",
      ui: {
        select: vi.fn().mockResolvedValue(undefined),
        input: vi.fn(),
        custom: vi.fn(),
      },
    };
    const result = (await tool.execute(
      "c4",
      { prompt: "Cancel me", options: ["Option A"] },
      undefined,
      undefined,
      ctx as never,
    )) as { content: { text: string }[] };
    expect(result.content[0].text).toBe("Question cancelled by user.");
  });
});
