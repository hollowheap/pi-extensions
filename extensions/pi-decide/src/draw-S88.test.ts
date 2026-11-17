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
    writeFileSync(join(dir, CONFIG_FILE_NAME), JSON.stringify({
      model: "typesafe/jev-latest",
      timeoutMs: 5000,
      maxInputChars: 20000,
      cacheTtlMs: 0,
    }));
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
});
