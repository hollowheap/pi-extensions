import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ agentDir: "" }));
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => state.agentDir,
}));
import { createDecideTool } from "../src/decide.js";
import {
  CONFIG_FILE_NAME,
  LEGACY_CONFIG_FILE_NAME,
  loadDecideConfig,
} from "../src/settings.js";

function textOf(result: unknown): string {
  return (
    (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? ""
  );
}

describe("an explicit provider/model is required with no fallback", () => {
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

  it("diagnoses out-of-range values and applies defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-decide-draw-"));
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        model: "bad-model",
        timeoutMs: 0,
        maxInputChars: 0,
        cacheTtlMs: -1,
      }),
    );
    const diagnostics: string[] = [];
    const config = loadDecideConfig(dir, (m) => diagnostics.push(m));
    const joined = diagnostics.join(" ");
    expect(joined).toContain("provider/model-id");
    expect(joined).toContain("timeoutMs");
    expect(joined).toContain("maxInputChars");
    expect(joined).toContain("cacheTtlMs");
    expect(config.model).toBeUndefined();
    expect(config.timeoutMs).toBe(5000);
    expect(config.maxInputChars).toBe(20000);
    expect(config.cacheTtlMs).toBe(600000);
  });

  it("loads a legacy classifier.json with a deprecation diagnostic", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-decide-draw-"));
    writeFileSync(
      join(dir, LEGACY_CONFIG_FILE_NAME),
      JSON.stringify({ model: "typesafe/jev-latest" }),
    );
    const diagnostics: string[] = [];
    const config = loadDecideConfig(dir, (m) => diagnostics.push(m));
    expect(config.model).toBe("typesafe/jev-latest");
    expect(config.path).toContain(LEGACY_CONFIG_FILE_NAME);
    expect(diagnostics.join(" ")).toContain("deprecated");
  });

  it("falls back to defaults for malformed or non-object configs", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-decide-draw-"));
    writeFileSync(join(dir, CONFIG_FILE_NAME), "{not json");
    const jsonDiagnostics: string[] = [];
    const jsonConfig = loadDecideConfig(dir, (m) => jsonDiagnostics.push(m));
    expect(jsonDiagnostics.join(" ")).toContain("not valid JSON");
    expect(jsonConfig.model).toBeUndefined();

    const other = mkdtempSync(join(tmpdir(), "pi-decide-draw-"));
    writeFileSync(join(other, CONFIG_FILE_NAME), "[]");
    const shapeDiagnostics: string[] = [];
    const shapeConfig = loadDecideConfig(other, (m) =>
      shapeDiagnostics.push(m),
    );
    expect(shapeDiagnostics.join(" ")).toContain("must be an object");
    expect(shapeConfig.timeoutMs).toBe(5000);
  });
});
