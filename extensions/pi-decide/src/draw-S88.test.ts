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

describe("S88: decide accepts one question and returns a structured result", () => {
  it("maps a choice answer to a label, confidence, and model", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-decide-draw-"));
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        model: "typesafe/jev-latest",
        timeoutMs: 5000,
        maxInputChars: 20000,
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
          choice: "allow",
          probabilities: { allow: 0.9, ask: 0.1 },
          confidence: 0.9,
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
        input: "ls",
        question: "Can this run?",
        labels: [
          { label: "allow", description: "Routine" },
          { label: "ask", description: "Needs judgment" },
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

    expect(result.details).toMatchObject({
      kind: "choice",
      value: "allow",
      confidence: 0.9,
      model: "typesafe/jev-latest",
    });
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it("S88 C02: maps a bool answer to a boolean value and probability", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-decide-draw-"));
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        model: "typesafe/jev-latest",
        timeoutMs: 5000,
        maxInputChars: 20000,
        cacheTtlMs: 0,
      }),
    );
    state.agentDir = dir;
    const classify = vi.fn(async () => ({
      api: "classifier",
      provider: "typesafe",
      model: "jev-latest",
      answers: {
        answer: { type: "bool", probability: 0.8, confidence: 0.8 },
      },
      stopReason: "stop",
      timestamp: 1_000,
    }));
    const tool = createDecideTool();
    const result = await tool.execute(
      "1",
      {
        kind: "bool",
        input: "has network",
        question: "bool-question-88",
        trueDescription: "yes",
        falseDescription: "no",
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
    expect(result.details).toMatchObject({
      kind: "bool",
      value: true,
      probability: 0.8,
      model: "typesafe/jev-latest",
    });
  });

  it("S88 C03: maps a score answer to an index and its level label", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-decide-draw-"));
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        model: "typesafe/jev-latest",
        timeoutMs: 5000,
        maxInputChars: 20000,
        cacheTtlMs: 0,
      }),
    );
    state.agentDir = dir;
    const classify = vi.fn(async () => ({
      api: "classifier",
      provider: "typesafe",
      model: "jev-latest",
      answers: {
        answer: { type: "score", score: 1, confidence: 0.7 },
      },
      stopReason: "stop",
      timestamp: 1_000,
    }));
    const tool = createDecideTool();
    const result = await tool.execute(
      "1",
      {
        kind: "score",
        input: "rate this",
        question: "score-question-88",
        labels: [
          { label: "low", description: "Low" },
          { label: "medium", description: "Medium" },
          { label: "high", description: "High" },
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
    expect(result.details).toMatchObject({
      kind: "score",
      value: 1,
      label: "medium",
      confidence: 0.7,
    });
  });

  it("S88 C04: forwards the question and criteria into the classifier payload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-decide-draw-"));
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        model: "typesafe/jev-latest",
        timeoutMs: 5000,
        maxInputChars: 20000,
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
          choice: "allow",
          probabilities: { allow: 0.9, deny: 0.1 },
          confidence: 0.9,
        },
      },
      stopReason: "stop",
      timestamp: 1_000,
    }));
    const tool = createDecideTool();
    await tool.execute(
      "1",
      {
        kind: "choice",
        input: "ls -la",
        question: "Is this safe?",
        labels: [
          { label: "allow", description: "Routine" },
          { label: "deny", description: "Dangerous" },
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
    const payload = (
      classify.mock.calls[0] as unknown[] | undefined
    )?.[1] as unknown as {
      state: { input: string };
      questions: {
        answer: { instructions: string; criteria: Record<string, string> };
      };
    };
    expect(payload.state.input).toBe("ls -la");
    expect(payload.questions.answer.instructions).toBe("Is this safe?");
    expect(payload.questions.answer.criteria).toEqual({
      allow: "Routine",
      deny: "Dangerous",
    });
  });
});
