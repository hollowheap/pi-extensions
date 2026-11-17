import { describe, expect, it, vi } from "vitest";
import { ANSWERS_TYPE, createQuestionTool } from "./index.js";
import { DONE_LABEL } from "./questions.js";

vi.mock("./alerts.js", () => ({ alertQuestion: vi.fn() }));
vi.mock("@hollowheap/core/prompt-lock", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, withPromptLock: vi.fn((fn: () => unknown) => fn()) };
});

function tool() {
  const pi = { appendEntry: vi.fn() };
  return { pi, questionTool: createQuestionTool(pi as never) };
}

function ctx(input = "") {
  return {
    hasUI: true,
    mode: "rpc",
    ui: {
      select: vi.fn().mockResolvedValue("A"),
      input: vi.fn().mockResolvedValue(input),
    },
  };
}

describe("S40: question mode is derived from tool parameters", () => {
  it("treats zero options as free text and options as single or multi via the flag", async () => {
    const free = tool();
    await free.questionTool.execute(
      "c1",
      { prompt: "Why?" },
      undefined,
      undefined,
      ctx("because") as never,
    );
    expect(free.pi.appendEntry).toHaveBeenCalledWith(
      ANSWERS_TYPE,
      expect.objectContaining({
        answers: [expect.objectContaining({ mode: "free", value: "because" })],
      }),
    );

    const single = tool();
    await single.questionTool.execute(
      "c2",
      { prompt: "Pick", options: ["A", "B"] },
      undefined,
      undefined,
      ctx() as never,
    );
    expect(single.pi.appendEntry).toHaveBeenCalledWith(
      ANSWERS_TYPE,
      expect.objectContaining({
        answers: [expect.objectContaining({ mode: "single", value: "A" })],
      }),
    );

    const multi = tool();
    const multiCtx = {
      hasUI: true,
      mode: "rpc",
      ui: {
        select: vi
          .fn()
          .mockResolvedValueOnce("[ ] A")
          .mockResolvedValueOnce(DONE_LABEL),
        input: vi.fn(),
      },
    };
    await multi.questionTool.execute(
      "c3",
      { prompt: "Pick", options: ["A", "B"], multi: true },
      undefined,
      undefined,
      multiCtx as never,
    );
    expect(multi.pi.appendEntry).toHaveBeenCalledWith(
      ANSWERS_TYPE,
      expect.objectContaining({
        answers: [expect.objectContaining({ mode: "multi", selected: ["A"] })],
      }),
    );
  });
});
