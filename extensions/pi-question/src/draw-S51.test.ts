import { describe, expect, it } from "vitest";
import {
  MAX_ANSWER,
  capAnswer,
  evaluateCondition,
  formatAnswers,
} from "./questions.js";

describe("S51: answers are numbered in source order and capped at 500 characters", () => {
  it("caps every answer and numbers source positions explicitly", () => {
    const long = "x".repeat(MAX_ANSWER + 100);
    expect(capAnswer(long)).toBe("x".repeat(MAX_ANSWER));

    expect(
      formatAnswers([
        { mode: "single", value: "Beta" },
        { mode: "multi", selected: ["Alpha", "Gamma"], writeIn: "custom" },
        { mode: "multi", selected: [] },
        { mode: "free", value: "" },
      ]),
    ).toBe(
      "1. Beta\n2. Alpha, Gamma, Write-in: custom\n3. none selected\n4. no answer",
    );

    const questions = [
      { prompt: "Ship?", mode: "single" as const, options: ["Yes", "No"] },
      { prompt: "Env?", mode: "single" as const, options: ["Prod", "Staging"] },
      { prompt: "Notify?", mode: "single" as const, options: ["a", "b"] },
    ];
    expect(
      formatAnswers(
        [
          { mode: "single", value: "No" },
          undefined,
          { mode: "single", value: "b" },
        ],
        questions,
      ),
    ).toBe("1. Ship?: No\n2. Env?: skipped\n3. Notify?: b");
  });
});

describe("empty, reconciliation, and condition seams", () => {
  it("S51 C02: short answers are unchanged and empty sets format explicitly", () => {
    expect(capAnswer("short")).toBe("short");
    expect(formatAnswers([])).toBe("");
    expect(formatAnswers([undefined])).toBe("1. skipped");
  });

  it("S51 C03: formatting is bounded by the question count when given", () => {
    const questions = [
      { prompt: "A?", mode: "single" as const, options: ["x"] },
      { prompt: "B?", mode: "single" as const, options: ["x"] },
      { prompt: "C?", mode: "single" as const, options: ["x"] },
    ];
    expect(formatAnswers([{ mode: "single", value: "yes" }], questions)).toBe(
      "1. A?: yes\n2. B?: skipped\n3. C?: skipped",
    );
    expect(
      formatAnswers(
        [
          { mode: "single", value: "yes" },
          { mode: "single", value: "no" },
        ],
        questions.slice(0, 1),
      ),
    ).toBe("1. A?: yes");
  });

  it("S51 C04: conditions compare prior answers by source position", () => {
    const answers = [
      { mode: "single" as const, value: "Yes" },
      { mode: "multi" as const, selected: ["A", "B"] },
    ];
    expect(evaluateCondition("answer1 == 'Yes'", answers)).toBe(true);
    expect(evaluateCondition("answer1 != 'Yes'", answers)).toBe(false);
    expect(evaluateCondition("answer2 == 'A,B'", answers)).toBe(true);
    expect(evaluateCondition("answer3 == 'x'", answers)).toBe(false);
    expect(evaluateCondition(undefined, answers)).toBe(true);
  });
});
