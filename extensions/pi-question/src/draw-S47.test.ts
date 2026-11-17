import { describe, expect, it, vi } from "vitest";
import extension, { ANSWERS_TYPE, createQuestionTool } from "./index.js";

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

function context(select: ReturnType<typeof vi.fn>) {
  return {
    hasUI: true,
    mode: "tui",
    ui: { select, input: vi.fn(), custom: vi.fn() },
  };
}

describe("S47: answers are emitted as one numbered custom follow-up entry", () => {
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
