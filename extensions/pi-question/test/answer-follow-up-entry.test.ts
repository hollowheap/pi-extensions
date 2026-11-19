import { describe, expect, it, vi } from "vitest";
import { ANSWERS_TYPE, createQuestionTool } from "../src/index.js";

vi.mock("@hollowheap/core/alerts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hollowheap/core/alerts")>()),
  deliverAlert: vi.fn().mockResolvedValue("native"),
}));
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

function context(select: ReturnType<typeof vi.fn>) {
  return {
    hasUI: true,
    mode: "rpc",
    ui: { select, input: vi.fn(), custom: vi.fn() },
  };
}

describe("answers are emitted as one numbered custom follow-up entry", () => {
  it("appends a single ANSWERS_TYPE entry with numbered answers", async () => {
    const pi = mockPi();
    const tool = createQuestionTool(pi as never);
    const ctx = context(vi.fn().mockResolvedValue("Option B"));

    await tool.execute(
      "call-1",
      { prompt: "Pick one", options: ["Option A", "Option B"] },
      undefined,
      undefined,
      ctx as never,
    );

    expect(pi.appendEntry).toHaveBeenCalledTimes(1);
    expect(pi.appendEntry).toHaveBeenCalledWith(
      ANSWERS_TYPE,
      expect.objectContaining({
        answers: [{ mode: "single", value: "Option B" }],
        askedAt: expect.any(Number),
      }),
    );
  });
});

describe("multi, metadata, and content seams", () => {
  it("a multi answer is emitted with its selected list", async () => {
    const pi = mockPi();
    const tool = createQuestionTool(pi as never);
    const ctx = {
      hasUI: true,
      mode: "rpc",
      ui: {
        select: vi
          .fn()
          .mockResolvedValueOnce("[ ] A")
          .mockResolvedValueOnce("Done"),
        input: vi.fn(),
      },
    };
    await tool.execute(
      "c2",
      { prompt: "Pick many", options: ["A", "B"], multi: true },
      undefined,
      undefined,
      ctx as never,
    );
    expect(pi.appendEntry).toHaveBeenCalledTimes(1);
    expect(pi.appendEntry).toHaveBeenCalledWith(
      ANSWERS_TYPE,
      expect.objectContaining({
        answers: [expect.objectContaining({ mode: "multi", selected: ["A"] })],
      }),
    );
  });

  it("the emitted entry carries the normalized question metadata", async () => {
    const pi = mockPi();
    const tool = createQuestionTool(pi as never);
    await tool.execute(
      "c3",
      { prompt: "Pick one", options: ["Option A", "Option B"] },
      undefined,
      undefined,
      context(vi.fn().mockResolvedValue("Option B")) as never,
    );
    expect(pi.appendEntry).toHaveBeenCalledWith(
      ANSWERS_TYPE,
      expect.objectContaining({
        questions: [
          expect.objectContaining({
            prompt: "Pick one",
            mode: "single",
            options: ["Option A", "Option B"],
          }),
        ],
      }),
    );
  });

  it("the tool returns the formatted numbered answer text", async () => {
    const pi = mockPi();
    const tool = createQuestionTool(pi as never);
    const result = (await tool.execute(
      "c4",
      { prompt: "Pick one", options: ["Option A", "Option B"] },
      undefined,
      undefined,
      context(vi.fn().mockResolvedValue("Option B")) as never,
    )) as { content: { text: string }[] };
    expect(result.content[0].text).toBe("1. Option B");
  });
});
