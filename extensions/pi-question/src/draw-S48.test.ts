import { describe, expect, it, vi } from "vitest";
import extension, { type createQuestionTool } from "./index.js";

vi.mock("./alerts.js", () => ({ alertQuestion: vi.fn() }));
vi.mock("@hollowheap/core/prompt-lock", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, withPromptLock: vi.fn((fn: () => unknown) => fn()) };
});

function mockPi() {
  return {
    on: vi.fn(() => () => {}),
    registerTool:
      vi.fn<(tool: ReturnType<typeof createQuestionTool>) => void>(),
    registerMessageRenderer: vi.fn(),
    registerMarkdownTransformer: vi.fn(),
    appendEntry: vi.fn(),
    getActiveTools: vi.fn(() => []),
    getAllTools: vi.fn(() => []),
    setActiveTools: vi.fn(),
  };
}

function registeredQuestionTool(pi: ReturnType<typeof mockPi>) {
  extension(pi as never);
  const tool = pi.registerTool.mock.calls[0]?.[0];
  expect(tool?.name).toBe("question");
  if (!tool) throw new Error("Question tool was not registered");
  return tool;
}

describe("registered question tool cancellation", () => {
  it("does not throw and emits no answers entry when the dialog is cancelled", async () => {
    const pi = mockPi();
    const tool = registeredQuestionTool(pi);
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
  it("cancelling the write-in input emits no answers entry", async () => {
    const pi = mockPi();
    const tool = registeredQuestionTool(pi);
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

  it("an aborted signal cancels without emitting an entry", async () => {
    const pi = mockPi();
    const tool = registeredQuestionTool(pi);
    const controller = new AbortController();
    controller.abort();
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

  it("cancellation reports the cancellation message", async () => {
    const pi = mockPi();
    const tool = registeredQuestionTool(pi);
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

  it("a cancelled tool result returns earlier answers without persisting them", async () => {
    const pi = mockPi();
    const tool = registeredQuestionTool(pi);
    const select = vi
      .fn()
      .mockResolvedValueOnce("Option A")
      .mockResolvedValueOnce(undefined);
    const result = await tool.execute(
      "partial",
      {
        questions: [
          { prompt: "First?", options: ["Option A"] },
          { prompt: "Second?", options: ["Option B"] },
        ],
      },
      undefined,
      undefined,
      { hasUI: true, mode: "rpc", ui: { select } } as never,
    );

    const details = result.details as {
      cancelled: boolean;
      answers: unknown[];
    };
    expect(details.cancelled).toBe(true);
    expect([...details.answers]).toEqual([
      { mode: "single", value: "Option A" },
    ]);
    expect(pi.appendEntry).not.toHaveBeenCalled();
  });
});
