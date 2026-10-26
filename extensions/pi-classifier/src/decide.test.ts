import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CONFIG_FILE_NAME } from "./config.js";
import { type DecideDeps, createDecideTool } from "./decide.js";

function agentDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-classifier-decide-"));
}

function config(model = "typesafe/jev-latest"): Record<string, unknown> {
  return { model, timeoutMs: 5000, maxInputChars: 20000, cacheTtlMs: 600000 };
}

function textOf(result: unknown): string {
  return (
    (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? ""
  );
}

function detailsOf(result: unknown): Record<string, unknown> {
  return ((result as { details?: Record<string, unknown> }).details ??
    {}) as Record<string, unknown>;
}

function classifierResult(answer: Record<string, unknown>): unknown {
  return {
    api: "classifier",
    provider: "typesafe",
    model: "jev-latest",
    answers: { answer },
    stopReason: "stop",
    timestamp: 1_000,
  };
}

function ctx(classify: ReturnType<typeof vi.fn>) {
  return {
    modelRegistry: {
      classify: classify as DecideDeps["classify"],
      getModelOfType: vi.fn(() => ({ id: "jev-latest" })),
    },
  };
}

describe("decide", () => {
  it("returns unavailable when no model is configured", async () => {
    const dir = agentDir();
    const tool = createDecideTool({
      loadConfig: () => ({
        timeoutMs: 5000,
        maxInputChars: 20000,
        cacheTtlMs: 600000,
        path: join(dir, CONFIG_FILE_NAME),
        diagnostics: [],
      }),
      classify: vi.fn() as DecideDeps["classify"],
      getAgentDir: () => dir,
    });

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
      ctx(vi.fn()) as never,
    );

    expect(textOf(result)).toContain("not configured");
    expect(detailsOf(result).error).toContain("not configured");
  });

  it("answers a choice question", async () => {
    const dir = agentDir();
    const classify = vi.fn(async () =>
      classifierResult({
        type: "choice",
        choice: "allow",
        probabilities: { allow: 0.9, ask: 0.1 },
        confidence: 0.9,
      }),
    );
    const tool = createDecideTool({
      loadConfig: () =>
        ({
          ...config(),
          path: join(dir, CONFIG_FILE_NAME),
          diagnostics: [],
        }) as never,
      classify: classify as DecideDeps["classify"],
      getAgentDir: () => dir,
    });

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
      ctx(classify) as never,
    );

    expect(textOf(result)).toContain('"value":"allow"');
    expect(detailsOf(result)).toMatchObject({
      kind: "choice",
      value: "allow",
      confidence: 0.9,
      model: "typesafe/jev-latest",
    });
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it("answers score and bool questions", async () => {
    const dir = agentDir();
    const scoreClassify = vi.fn(async () =>
      classifierResult({
        type: "score",
        score: 1,
        confidence: 0.8,
      }),
    );
    const scoreTool = createDecideTool({
      loadConfig: () =>
        ({
          ...config(),
          path: join(dir, CONFIG_FILE_NAME),
          diagnostics: [],
        }) as never,
      classify: scoreClassify as DecideDeps["classify"],
      getAgentDir: () => dir,
    });
    const scoreResult = await scoreTool.execute(
      "1",
      {
        kind: "score",
        input: "spec",
        question: "Granularity?",
        labels: [
          { label: "too_fine", description: "too small" },
          { label: "atomic", description: "one slice" },
        ],
      },
      undefined,
      undefined,
      ctx(scoreClassify) as never,
    );
    expect(detailsOf(scoreResult).value).toBe(1);

    const boolClassify = vi.fn(async () =>
      classifierResult({ type: "bool", probability: 0.95 }),
    );
    const boolTool = createDecideTool({
      loadConfig: () =>
        ({
          ...config(),
          path: join(dir, CONFIG_FILE_NAME),
          diagnostics: [],
        }) as never,
      classify: boolClassify as DecideDeps["classify"],
      getAgentDir: () => dir,
    });
    const boolResult = await boolTool.execute(
      "1",
      {
        kind: "bool",
        input: "rm -rf build",
        question: "Destructive?",
        trueDescription: "deletes data",
        falseDescription: "safe",
      },
      undefined,
      undefined,
      ctx(boolClassify) as never,
    );
    expect(detailsOf(boolResult).value).toBe(true);
    expect(detailsOf(boolResult).probability).toBe(0.95);
  });

  it("rejects invalid input and labels", async () => {
    const dir = agentDir();
    const tool = createDecideTool({
      loadConfig: () =>
        ({
          ...config(),
          path: join(dir, CONFIG_FILE_NAME),
          diagnostics: [],
        }) as never,
      classify: vi.fn() as DecideDeps["classify"],
      getAgentDir: () => dir,
    });
    const ctxValue = ctx(vi.fn());

    const empty = await tool.execute(
      "1",
      {
        kind: "choice",
        input: "",
        question: "q",
        labels: [
          { label: "a", description: "x" },
          { label: "b", description: "y" },
        ],
      },
      undefined,
      undefined,
      ctxValue as never,
    );
    expect(textOf(empty)).toContain("input is required");

    const bad = await tool.execute(
      "1",
      {
        kind: "choice",
        input: "x",
        question: "q",
        labels: [{ label: "a", description: "x" }],
      },
      undefined,
      undefined,
      ctxValue as never,
    );
    expect(textOf(bad)).toContain("2-10 labels");

    const missingBool = await tool.execute(
      "1",
      { kind: "bool", input: "x", question: "q" },
      undefined,
      undefined,
      ctxValue as never,
    );
    expect(textOf(missingBool)).toContain("true and false descriptions");
  });

  it("returns classifier errors", async () => {
    const dir = agentDir();
    const classify = vi.fn(async () => ({
      api: "classifier",
      provider: "typesafe",
      model: "jev-latest",
      answers: {},
      stopReason: "error",
      errorMessage: "model unavailable",
      timestamp: 1_000,
    }));
    const tool = createDecideTool({
      loadConfig: () =>
        ({
          ...config(),
          path: join(dir, CONFIG_FILE_NAME),
          diagnostics: [],
        }) as never,
      classify: classify as DecideDeps["classify"],
      getAgentDir: () => dir,
    });

    const result = await tool.execute(
      "1",
      {
        kind: "bool",
        input: "x",
        question: "q",
        trueDescription: "yes",
        falseDescription: "no",
      },
      undefined,
      undefined,
      ctx(classify) as never,
    );

    expect(textOf(result)).toContain("model unavailable");
    expect(detailsOf(result).error).toContain("model unavailable");
  });

  it("returns a text error when classify rejects", async () => {
    const dir = agentDir();
    const classify = vi.fn(async () => {
      throw new Error("transport failed");
    });
    const tool = createDecideTool({
      loadConfig: () =>
        ({
          ...config(),
          path: join(dir, CONFIG_FILE_NAME),
          diagnostics: [],
        }) as never,
      classify: classify as DecideDeps["classify"],
      getAgentDir: () => dir,
    });

    const result = await tool.execute(
      "1",
      {
        kind: "bool",
        input: "x",
        question: "q",
        trueDescription: "yes",
        falseDescription: "no",
      },
      undefined,
      undefined,
      ctx(classify) as never,
    );

    expect(textOf(result)).toContain("transport failed");
    expect(detailsOf(result).error).toContain("transport failed");
  });

  it("does not let one caller's abort poison concurrent waiters", async () => {
    const dir = agentDir();
    let releaseClassify!: (value: unknown) => void;
    const gate = new Promise<unknown>((resolve) => {
      releaseClassify = resolve;
    });
    const classify = vi.fn(async () => {
      await gate;
      return classifierResult({ type: "bool", probability: 0.8 });
    });
    const tool = createDecideTool({
      loadConfig: () =>
        ({
          ...config(),
          path: join(dir, CONFIG_FILE_NAME),
          diagnostics: [],
        }) as never,
      classify: classify as DecideDeps["classify"],
      getAgentDir: () => dir,
    });
    const params = {
      kind: "bool" as const,
      input: "x",
      question: "q",
      trueDescription: "yes",
      falseDescription: "no",
    };
    const controller = new AbortController();

    const aborted = tool.execute(
      "1",
      params,
      controller.signal,
      undefined,
      ctx(classify) as never,
    );
    const waiter = tool.execute(
      "2",
      params,
      undefined,
      undefined,
      ctx(classify) as never,
    );
    expect(classify).toHaveBeenCalledTimes(1);
    controller.abort();
    releaseClassify(undefined);

    const [abortedResult, waiterResult] = await Promise.all([aborted, waiter]);
    expect(textOf(abortedResult)).toContain("aborted");
    expect(detailsOf(waiterResult).error).toBeUndefined();
    expect(detailsOf(waiterResult).value).toBe(true);
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it("uses a stable cache key across label order", async () => {
    const dir = agentDir();
    const classify = vi.fn(async () =>
      classifierResult({
        type: "choice",
        choice: "a",
        probabilities: { a: 0.8, b: 0.2 },
        confidence: 0.8,
      }),
    );
    const tool = createDecideTool({
      loadConfig: () =>
        ({
          ...config(),
          path: join(dir, CONFIG_FILE_NAME),
          diagnostics: [],
        }) as never,
      classify: classify as DecideDeps["classify"],
      getAgentDir: () => dir,
    });
    const base = {
      kind: "choice" as const,
      input: "x",
      question: "q",
      labels: [
        { label: "a", description: "first" },
        { label: "b", description: "second" },
      ],
    };

    await tool.execute("1", base, undefined, undefined, ctx(classify) as never);
    await tool.execute(
      "2",
      { ...base, labels: [...base.labels].reverse() },
      undefined,
      undefined,
      ctx(classify) as never,
    );

    expect(classify).toHaveBeenCalledTimes(1);
  });

  it("returns an error when the configured model cannot be used", async () => {
    const dir = agentDir();
    const tool = createDecideTool({
      loadConfig: () =>
        ({
          ...config(),
          path: join(dir, CONFIG_FILE_NAME),
          diagnostics: [],
        }) as never,
      getAgentDir: () => dir,
    });
    const registry = {
      classify: vi.fn() as DecideDeps["classify"],
      getModelOfType: vi.fn(() => undefined),
    };
    const ctxValue = { modelRegistry: registry };
    const result = await tool.execute(
      "1",
      {
        kind: "bool",
        input: "x",
        question: "q",
        trueDescription: "yes",
        falseDescription: "no",
      },
      undefined,
      undefined,
      ctxValue as never,
    );

    expect(textOf(result)).toContain("classifier model not found");
    expect(registry.classify).not.toHaveBeenCalled();
  });

  it("enforces the input cap", async () => {
    const dir = agentDir();
    const tool = createDecideTool({
      loadConfig: () => ({
        model: "typesafe/jev-latest",
        timeoutMs: 5000,
        maxInputChars: 3,
        cacheTtlMs: 600000,
        path: join(dir, CONFIG_FILE_NAME),
        diagnostics: [],
      }),
      classify: vi.fn() as DecideDeps["classify"],
      getAgentDir: () => dir,
    });

    const result = await tool.execute(
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
      ctx(vi.fn()) as never,
    );

    expect(textOf(result)).toContain("exceeds 3 characters");
  });

  it("caches successful results and shares concurrent requests", async () => {
    const dir = agentDir();
    const classify = vi.fn(async () =>
      classifierResult({ type: "bool", probability: 0.8 }),
    );
    const tool = createDecideTool({
      loadConfig: () =>
        ({
          ...config(),
          path: join(dir, CONFIG_FILE_NAME),
          diagnostics: [],
        }) as never,
      classify: classify as DecideDeps["classify"],
      getAgentDir: () => dir,
    });

    const first = await tool.execute(
      "1",
      {
        kind: "bool",
        input: "x",
        question: "q",
        trueDescription: "yes",
        falseDescription: "no",
      },
      undefined,
      undefined,
      ctx(classify) as never,
    );
    const second = await tool.execute(
      "2",
      {
        kind: "bool",
        input: "x",
        question: "q",
        trueDescription: "yes",
        falseDescription: "no",
      },
      undefined,
      undefined,
      ctx(classify) as never,
    );

    expect(textOf(first)).toBe(textOf(second));
    expect(classify).toHaveBeenCalledTimes(1);

    const [a, b] = await Promise.all([
      tool.execute(
        "3",
        {
          kind: "bool",
          input: "y",
          question: "q",
          trueDescription: "yes",
          falseDescription: "no",
        },
        undefined,
        undefined,
        ctx(classify) as never,
      ),
      tool.execute(
        "4",
        {
          kind: "bool",
          input: "y",
          question: "q",
          trueDescription: "yes",
          falseDescription: "no",
        },
        undefined,
        undefined,
        ctx(classify) as never,
      ),
    ]);
    expect(textOf(a)).toBe(textOf(b));
    expect(classify).toHaveBeenCalledTimes(2);
  });

  it("does not cache when TTL is zero or a call is aborted", async () => {
    const dir = agentDir();
    const classify = vi.fn(async () =>
      classifierResult({ type: "bool", probability: 0.8 }),
    );
    const tool = createDecideTool({
      loadConfig: () => ({
        model: "typesafe/jev-latest",
        timeoutMs: 5000,
        maxInputChars: 20000,
        cacheTtlMs: 0,
        path: join(dir, CONFIG_FILE_NAME),
        diagnostics: [],
      }),
      classify: classify as DecideDeps["classify"],
      getAgentDir: () => dir,
    });

    await tool.execute(
      "1",
      {
        kind: "bool",
        input: "x",
        question: "q",
        trueDescription: "yes",
        falseDescription: "no",
      },
      undefined,
      undefined,
      ctx(classify) as never,
    );
    await tool.execute(
      "2",
      {
        kind: "bool",
        input: "x",
        question: "q",
        trueDescription: "yes",
        falseDescription: "no",
      },
      undefined,
      undefined,
      ctx(classify) as never,
    );
    expect(classify).toHaveBeenCalledTimes(2);

    const abortedClassify = vi.fn(async () =>
      classifierResult({ type: "bool", probability: 0.8 }),
    );
    const abortTool = createDecideTool({
      loadConfig: () =>
        ({
          ...config(),
          path: join(dir, CONFIG_FILE_NAME),
          diagnostics: [],
        }) as never,
      classify: abortedClassify as DecideDeps["classify"],
      getAgentDir: () => dir,
    });
    const aborted = await abortTool.execute(
      "3",
      {
        kind: "bool",
        input: "z",
        question: "q",
        trueDescription: "yes",
        falseDescription: "no",
      },
      AbortSignal.abort(),
      undefined,
      ctx(abortedClassify) as never,
    );
    expect(textOf(aborted)).toContain("aborted");
    await abortTool.execute(
      "3",
      {
        kind: "bool",
        input: "z",
        question: "q",
        trueDescription: "yes",
        falseDescription: "no",
      },
      undefined,
      undefined,
      ctx(abortedClassify) as never,
    );
    expect(abortedClassify).toHaveBeenCalledTimes(1);
  });

  it("reports a classifier timeout as text", async () => {
    const dir = agentDir();
    const classify = vi.fn(async (_ctx, _model, _input, signal) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (signal?.aborted) {
        return {
          api: "classifier",
          provider: "typesafe",
          model: "jev-latest",
          answers: {},
          stopReason: "aborted",
          errorMessage: "timed out",
          timestamp: 1_000,
        };
      }
      return classifierResult({ type: "bool", probability: 0.8 });
    });
    const tool = createDecideTool({
      loadConfig: () => ({
        model: "typesafe/jev-latest",
        timeoutMs: 1,
        maxInputChars: 20000,
        cacheTtlMs: 600000,
        path: join(dir, CONFIG_FILE_NAME),
        diagnostics: [],
      }),
      classify: classify as DecideDeps["classify"],
      getAgentDir: () => dir,
    });

    const result = await tool.execute(
      "1",
      {
        kind: "bool",
        input: "x",
        question: "q",
        trueDescription: "yes",
        falseDescription: "no",
      },
      undefined,
      undefined,
      ctx(classify) as never,
    );

    expect(textOf(result)).toContain("timed out");
    expect(detailsOf(result).error).toContain("timed out");
  });

  it("sends only caller-supplied input and criteria", async () => {
    const dir = agentDir();
    const classify = vi.fn(async () =>
      classifierResult({ type: "bool", probability: 0.8 }),
    );
    const tool = createDecideTool({
      loadConfig: () =>
        ({
          ...config(),
          path: join(dir, CONFIG_FILE_NAME),
          diagnostics: [],
        }) as never,
      classify: classify as DecideDeps["classify"],
      getAgentDir: () => dir,
    });

    await tool.execute(
      "1",
      {
        kind: "bool",
        input: "secret-ish input",
        question: "safe?",
        trueDescription: "yes",
        falseDescription: "no",
      },
      undefined,
      undefined,
      ctx(classify) as never,
    );

    expect(classify).toHaveBeenCalledWith(
      expect.anything(),
      "typesafe/jev-latest",
      {
        state: { input: "secret-ish input" },
        questions: {
          answer: {
            type: "bool",
            instructions: "safe?",
            criteria: { true: "yes", false: "no" },
          },
        },
      },
      expect.any(AbortSignal),
    );
  });
});
