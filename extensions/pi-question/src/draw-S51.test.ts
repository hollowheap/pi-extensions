import { describe, expect, it } from "vitest";
import { MAX_ANSWER, capAnswer, formatAnswers } from "./questions.js";

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
