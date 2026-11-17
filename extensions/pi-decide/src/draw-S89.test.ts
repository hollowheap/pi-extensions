import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ agentDir: "" }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));
import { CONFIG_FILE_NAME, loadDecideConfig } from "./config.js";
import { createDecideTool } from "./decide.js";

function textOf(result: unknown): string {
  return (
    (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? ""
  );
}

describe("S89: an explicit provider/model is required with no fallback", () => {
  it("validates a configured model and reports an unconfigured classifier", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-decide-draw-"));
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        model: "typesafe/jev-latest",
        timeoutMs: 2000,
        maxInputChars: 1000,
        cacheTtlMs: 0,
      }),
    );
    const config = loadDecideConfig(dir);
    expect(config.model).toBe("typesafe/jev-latest");
    expect(config.diagnostics).toEqual([]);

    state.agentDir = dir;
    const tool = createDecideTool();
    const result = await tool.execute(
      "1",
      {
        kind: "bool",
        input: "ls",
        question: "safe?",
        trueDescription: "yes",
        falseDescription: "no",
      },
      undefined,
      undefined,
      {
        sessionManager: {},
        modelRegistry: {
          classify: vi.fn(async () => ({
            api: "classifier",
            provider: "typesafe",
            model: "jev-latest",
            answers: {
              answer: {
                type: "bool",
                probability: 0.9,
                confidence: 0.9,
              },
            },
            stopReason: "stop",
            timestamp: 1_000,
          })),
          getModelOfType: vi.fn(() => ({ id: "jev-latest" })),
        },
      } as never,
    );
    expect(textOf(result)).toContain('"value":');

    writeFileSync(join(dir, CONFIG_FILE_NAME), JSON.stringify({}));
    const unconfigured = await createDecideTool().execute(
      "2",
      {
        kind: "bool",
        input: "ls",
        question: "safe?",
        trueDescription: "yes",
        falseDescription: "no",
      },
      undefined,
      undefined,
      {
        sessionManager: {},
        modelRegistry: { classify: vi.fn(), getModelOfType: vi.fn() },
      } as never,
    );
    expect(textOf(unconfigured)).toContain("not configured");
  });
});
