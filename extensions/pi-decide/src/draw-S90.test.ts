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
    writeFileSync(join(dir, CONFIG_FILE_NAME), JSON.stringify({
      model: "typesafe/jev-latest",
      timeoutMs: 5000,
      maxInputChars: 3,
      cacheTtlMs: 0,
    }));
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
});
