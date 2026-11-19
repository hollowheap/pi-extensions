import { describe, expect, it } from "vitest";
import {
  MAX_ANSWER,
  capAnswer,
  evaluateCondition,
  formatAnswers,
} from "../src/questions.js";

describe("evaluateCondition", () => {
  it("evaluates equality and inequality conditions", () => {
    const answers = [{ mode: "single" as const, value: "Yes" }];
    expect(evaluateCondition("answer1 == 'Yes'", answers)).toBe(true);
    expect(evaluateCondition("answer1 != 'No'", answers)).toBe(true);
    expect(evaluateCondition("answer1 == 'No'", answers)).toBe(false);
    expect(evaluateCondition("answer2 == 'Yes'", answers)).toBe(false);
    expect(evaluateCondition("unknown", answers)).toBe(false);
  });
});

describe("formatAnswers", () => {
  it("numbers single, multi, and free-text answers without question text", () => {
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
  });

  it("numbers answers by source position and includes question text with skipped slots", () => {
    const questions = [
      { prompt: "Ship?", mode: "single" as const, options: ["Yes", "No"] },
      { prompt: "Env?", mode: "single" as const, options: ["Prod", "Staging"] },
      { prompt: "Notify?", mode: "single" as const, options: ["a", "b"] },
    ];
    const answers = [
      { mode: "single" as const, value: "No" },
      undefined,
      { mode: "single" as const, value: "b" },
    ];
    expect(formatAnswers(answers, questions)).toBe(
      "1. Ship?: No\n2. Env?: skipped\n3. Notify?: b",
    );
  });

  it("keeps a write-in-only multi answer and ignores an empty write-in", () => {
    expect(
      formatAnswers([
        { mode: "multi", selected: [], writeIn: "custom" },
        { mode: "multi", selected: ["Alpha"], writeIn: "" },
      ]),
    ).toBe("1. Write-in: custom\n2. Alpha");
  });

  it("caps every answer at 500 characters", () => {
    const long = "x".repeat(MAX_ANSWER + 100);
    expect(capAnswer(long)).toBe("x".repeat(MAX_ANSWER));
    expect(
      formatAnswers([
        { mode: "single", value: long },
        { mode: "multi", selected: [], writeIn: long },
        { mode: "free", value: long },
      ]),
    ).toBe(
      `1. ${"x".repeat(MAX_ANSWER)}\n2. Write-in: ${"x".repeat(
        MAX_ANSWER,
      )}\n3. ${"x".repeat(MAX_ANSWER)}`,
    );
  });

  it("returns nothing for no answers", () => {
    expect(formatAnswers([])).toBe("");
  });
});
