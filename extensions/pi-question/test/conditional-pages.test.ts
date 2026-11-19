import { describe, expect, it } from "vitest";
import {
  capAnswer,
  evaluateCondition,
  formatAnswers,
} from "../src/questions.js";

describe("conditional multi-page questions", () => {
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

  it("absent answers and unknown conditions are handled safely", () => {
    expect(evaluateCondition(undefined, [])).toBe(true);
    expect(
      evaluateCondition("answer2 == 'yes'", [{ mode: "single", value: "yes" }]),
    ).toBe(false);
    expect(evaluateCondition("something else", [])).toBe(false);
    expect(formatAnswers([])).toBe("");
  });

  it("empty selections and blank free answers render placeholders", () => {
    expect(
      formatAnswers([
        { mode: "multi", selected: [] },
        { mode: "free", value: "" },
      ]),
    ).toBe("1. none selected\n2. no answer");
  });

  it("multi answers and write-ins are capped before formatting", () => {
    const formatted = formatAnswers([
      {
        mode: "multi",
        selected: ["a".repeat(600)],
        writeIn: "b".repeat(600),
        prompt: "Pick",
      },
    ]);
    expect(formatted).toBe(
      `1. Pick: ${"a".repeat(500)}, Write-in: ${"b".repeat(500)}`,
    );
  });
});
