import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ agentDir: "" }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));
import { CONFIG_FILE_NAME } from "./config.js";
import { createDecideTool } from "./decide.js";

function textOf(result: unknown): string {
  return (
    (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? ""
  );
}

describe("S90: input cap and capability failures are reported as text", () => {
  it("rejects oversize input before the classifier runs and reports stop reasons", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-decide-draw-"));
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        model: "typesafe/jev-latest",
        timeoutMs: 5000,
        maxInputChars: 3,
        cacheTtlMs: 0,
      }),
    );
    state.agentDir = dir;
    const classify = vi.fn();
    const tool = createDecideTool();
    const ctx = {
      sessionManager: {},
      modelRegistry: {
        classify,
        getModelOfType: vi.fn(() => ({ id: "jev-latest" })),
      },
    };

    const oversize = await tool.execute(
      "1",
      {
        kind: "bool",
        input: "abcd",
        question: "q",
        trueDescription: "yes",
        falseDescription: "no",
      },
      undefined,
      undefined,
      ctx as never,
    );
    expect(textOf(oversize)).toContain("exceeds 3 characters");
    expect(classify).not.toHaveBeenCalled();

    classify.mockResolvedValueOnce({
      api: "classifier",
      provider: "typesafe",
      model: "jev-latest",
      answers: {},
      stopReason: "length",
      errorMessage: "too long",
      timestamp: 1_000,
    });
    const failed = await createDecideTool().execute(
      "2",
      {
        kind: "bool",
        input: "a",
        question: "q",
        trueDescription: "yes",
        falseDescription: "no",
      },
      undefined,
      undefined,
      ctx as never,
    );
    expect(textOf(failed)).toContain("too long");
  });

  it("S90 C02: reports an aborted signal without calling the classifier", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-decide-draw-"));
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        model: "typesafe/jev-latest",
        timeoutMs: 5000,
        maxInputChars: 100,
        cacheTtlMs: 0,
      }),
    );
    state.agentDir = dir;
    const classify = vi.fn();
    const tool = createDecideTool();
    const controller = new AbortController();
    controller.abort();
    const result = await tool.execute(
      "1",
      {
        kind: "bool",
        input: "abc",
        question: "abort-question-90",
        trueDescription: "yes",
        falseDescription: "no",
      },
      controller.signal,
      undefined,
      {
        sessionManager: {},
        modelRegistry: {
          classify,
          getModelOfType: vi.fn(() => ({ id: "jev-latest" })),
        },
      } as never,
    );
    expect(textOf(result)).toContain("aborted");
    expect(classify).not.toHaveBeenCalled();
  });

  it("S90 C03: rejects a classifier answer outside the label set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-decide-draw-"));
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        model: "typesafe/jev-latest",
        timeoutMs: 5000,
        maxInputChars: 100,
        cacheTtlMs: 0,
      }),
    );
    state.agentDir = dir;
    const classify = vi.fn(async () => ({
      api: "classifier",
      provider: "typesafe",
      model: "jev-latest",
      answers: {
        answer: {
          type: "choice",
          choice: "maybe",
          probabilities: { maybe: 1 },
          confidence: 1,
        },
      },
      stopReason: "stop",
      timestamp: 1_000,
    }));
    const tool = createDecideTool();
    const result = await tool.execute(
      "1",
      {
        kind: "choice",
        input: "abc",
        question: "unknown-choice-90",
        labels: [
          { label: "allow", description: "Allow" },
          { label: "deny", description: "Deny" },
        ],
      },
      undefined,
      undefined,
      {
        sessionManager: {},
        modelRegistry: {
          classify,
          getModelOfType: vi.fn(() => ({ id: "jev-latest" })),
        },
      } as never,
    );
    expect(textOf(result)).toContain("unknown choice");
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it("S90 C04: rejects empty input and question before classification", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-decide-draw-"));
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        model: "typesafe/jev-latest",
        timeoutMs: 5000,
        maxInputChars: 100,
        cacheTtlMs: 0,
      }),
    );
    state.agentDir = dir;
    const classify = vi.fn();
    const tool = createDecideTool();
    const ctx = {
      sessionManager: {},
      modelRegistry: {
        classify,
        getModelOfType: vi.fn(() => ({ id: "jev-latest" })),
      },
    };
    const emptyInput = await tool.execute(
      "1",
      {
        kind: "bool",
        input: "   ",
        question: "q",
        trueDescription: "yes",
        falseDescription: "no",
      },
      undefined,
      undefined,
      ctx as never,
    );
    const emptyQuestion = await tool.execute(
      "2",
      {
        kind: "bool",
        input: "abc",
        question: "   ",
        trueDescription: "yes",
        falseDescription: "no",
      },
      undefined,
      undefined,
      ctx as never,
    );
    expect(textOf(emptyInput)).toContain("input is required");
    expect(textOf(emptyQuestion)).toContain("question is required");
    expect(classify).not.toHaveBeenCalled();
  });
});
