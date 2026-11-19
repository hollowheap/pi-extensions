import { describe, expect, it, vi } from "vitest";
import { ANSWERS_TYPE, createQuestionTool } from "../src/index.js";
import { DONE_LABEL } from "../src/questions.js";

vi.mock("@hollowheap/core/alerts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hollowheap/core/alerts")>()),
  deliverAlert: vi.fn().mockResolvedValue("native"),
}));
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

describe("question mode is derived from tool parameters", () => {
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

describe("shorthand, empty, and sanitization seams", () => {
  it("a string in the questions array becomes a free-text question", async () => {
    const { pi, questionTool } = tool();
    await questionTool.execute(
      "c2",
      { questions: ["Why?"] },
      undefined,
      undefined,
      ctx("because") as never,
    );
    expect(pi.appendEntry).toHaveBeenCalledWith(
      ANSWERS_TYPE,
      expect.objectContaining({
        answers: [expect.objectContaining({ mode: "free", value: "because" })],
      }),
    );
  });

  it("an empty parameter set reports an error without emitting", async () => {
    const { pi, questionTool } = tool();
    const result = (await questionTool.execute(
      "c3",
      {},
      undefined,
      undefined,
      ctx() as never,
    )) as { content: { text: string }[] };
    expect(result.content[0].text).toBe("Error: No question prompt provided.");
    expect(pi.appendEntry).not.toHaveBeenCalled();
  });

  it("prompt and options are sanitized in the emitted entry", async () => {
    const { pi, questionTool } = tool();
    const interactive = {
      hasUI: true,
      mode: "rpc",
      ui: {
        select: vi.fn().mockResolvedValue("A"),
        input: vi.fn(),
      },
    };
    await questionTool.execute(
      "c4",
      {
        prompt: "\u001b[31mPick\u001b[0m",
        options: ["\u001b[31mA\u001b[0m", "B"],
      },
      undefined,
      undefined,
      interactive as never,
    );
    expect(pi.appendEntry).toHaveBeenCalledWith(
      ANSWERS_TYPE,
      expect.objectContaining({
        questions: [
          expect.objectContaining({
            prompt: "Pick",
            mode: "single",
            options: ["A", "B"],
          }),
        ],
      }),
    );
  });
});
