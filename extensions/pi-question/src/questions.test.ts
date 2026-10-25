import { describe, expect, it } from "vitest";
import {
  MAX_ANSWER,
  capAnswer,
  formatAnswers,
  parseQuestionBlock,
} from "./questions.js";

describe("parseQuestionBlock", () => {
  it("parses a single-select question with ordered options", () => {
    expect(parseQuestionBlock("## Pick one\n1. Alpha\n2. Beta")).toEqual([
      { prompt: "Pick one", mode: "single", options: ["Alpha", "Beta"] },
    ]);
  });

  it("treats checkbox presence as the multi-select marker", () => {
    expect(
      parseQuestionBlock("## Pick many\n1. [ ] Alpha\n2. [x] Beta"),
    ).toEqual([
      { prompt: "Pick many", mode: "multi", options: ["Alpha", "Beta"] },
    ]);
  });

  it("parses zero options as free text", () => {
    expect(parseQuestionBlock("## Why?")).toEqual([
      { prompt: "Why?", mode: "free", options: [] },
    ]);
  });

  it("keeps multiple questions in source order and ignores other headings", () => {
    expect(
      parseQuestionBlock(
        "# Title\n## First\n1. Alpha\n### Note\n## Second\n1. [ ] Beta\n2. [x] Gamma",
      ),
    ).toEqual([
      { prompt: "First", mode: "single", options: ["Alpha"] },
      { prompt: "Second", mode: "multi", options: ["Beta", "Gamma"] },
    ]);
  });

  it("rejects a block with no H2", () => {
    expect(parseQuestionBlock("# Title\n1. Alpha")).toBeUndefined();
    expect(parseQuestionBlock("")).toBeUndefined();
  });

  it("rejects unordered options and mixed checkbox modes", () => {
    expect(parseQuestionBlock("## Q\n- Alpha")).toBeUndefined();
    expect(parseQuestionBlock("## Q\n1. [ ] Alpha\n2. Beta")).toBeUndefined();
  });

  it("accepts the eight-option boundary", () => {
    const options = Array.from(
      { length: 8 },
      (_, index) => `${index + 1}. Option ${index + 1}`,
    ).join("\n");
    const parsed = parseQuestionBlock(`## Q\n${options}`);
    expect(parsed?.[0].mode).toBe("single");
    expect(parsed?.[0].options).toHaveLength(8);
  });

  it("rejects more than eight options", () => {
    const options = Array.from(
      { length: 9 },
      (_, index) => `${index + 1}. Option ${index + 1}`,
    ).join("\n");
    expect(parseQuestionBlock(`## Q\n${options}`)).toBeUndefined();
  });

  it("rejects the reserved write-in label and empty options", () => {
    expect(
      parseQuestionBlock("## Q\n1. Alpha\n2. Write-in answer"),
    ).toBeUndefined();
    expect(parseQuestionBlock("## Q\n1. [ ] ")).toBeUndefined();
  });

  it("rejects options before the first H2", () => {
    expect(parseQuestionBlock("1. Alpha\n## Q")).toBeUndefined();
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
