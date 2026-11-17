import { describe, expect, it } from "vitest";
import { capAnswer, evaluateCondition, formatAnswers } from "./questions.js";

describe("S134 conditional multi-page questions", () => {
  it("evaluates page conditions and formats answers within the answer cap", () => {
    const answers = [{ mode: "single" as const, value: "yes" }];
    expect(evaluateCondition("answer1 == 'yes'", answers)).toBe(true);
    expect(evaluateCondition("answer1 == 'no'", answers)).toBe(false);

    expect(
      formatAnswers(answers, [
        { prompt: "Continue?", mode: "single", options: [] },
      ]),
    ).toContain("Continue?: yes");
    expect(capAnswer("a".repeat(600)).length).toBe(500);
  });
});
