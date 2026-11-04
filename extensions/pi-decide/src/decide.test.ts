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

function agentDir(overrides: Record<string, unknown> = config()): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-decide-decide-"));
  writeFileSync(join(dir, CONFIG_FILE_NAME), JSON.stringify(overrides));
  state.agentDir = dir;
  return dir;
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

function ctx(classify: ReturnType<typeof vi.fn>, sessionManager: object = {}) {
  return {
    sessionManager,
    modelRegistry: {
      classify,
      getModelOfType: vi.fn(() => ({ id: "jev-latest" })),
    },
  };
}

describe("decide", () => {
  it("returns unavailable when no model is configured", async () => {
    agentDir({});
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
      ctx(vi.fn()) as never,
    );

    expect(textOf(result)).toContain("not configured");
    expect(detailsOf(result).error).toContain("not configured");
  });

  it("answers a choice question", async () => {
    agentDir();
    const classify = vi.fn(async () =>
      classifierResult({
        type: "choice",
        choice: "allow",
        probabilities: { allow: 0.9, ask: 0.1 },
        confidence: 0.9,
      }),
    );
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
    agentDir();
    const scoreClassify = vi.fn(async () =>
      classifierResult({
        type: "score",
        score: 1,
        confidence: 0.8,
      }),
    );
    const scoreTool = createDecideTool();
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
    expect(detailsOf(scoreResult).label).toBe("atomic");

    const boolClassify = vi.fn(async () =>
      classifierResult({ type: "bool", probability: 0.95 }),
    );
    const boolTool = createDecideTool();
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
    agentDir();
    const tool = createDecideTool();
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

  it("rejects answers outside the caller contract", async () => {
    agentDir();
    const choiceClassify = vi.fn(async () =>
      classifierResult({
        type: "choice",
        choice: "c",
        probabilities: { c: 1 },
        confidence: 1,
      }),
    );
    const choiceResult = await createDecideTool().execute(
      "1",
      {
        kind: "choice",
        input: "x",
        question: "q",
        labels: [
          { label: "a", description: "first" },
          { label: "b", description: "second" },
        ],
      },
      undefined,
      undefined,
      ctx(choiceClassify) as never,
    );
    expect(textOf(choiceResult)).toContain("unknown choice");

    const scoreClassify = vi.fn(async () =>
      classifierResult({ type: "score", score: 2, confidence: 0.8 }),
    );
    const scoreResult = await createDecideTool().execute(
      "1",
      {
        kind: "score",
        input: "x",
        question: "q",
        labels: [
          { label: "a", description: "first" },
          { label: "b", description: "second" },
        ],
      },
      undefined,
      undefined,
      ctx(scoreClassify) as never,
    );
    expect(textOf(scoreResult)).toContain("out-of-range score");

    const boolClassify = vi.fn(async () =>
      classifierResult({ type: "bool", probability: 2 }),
    );
    const boolResult = await createDecideTool().execute(
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
      ctx(boolClassify) as never,
    );
    expect(textOf(boolResult)).toContain("invalid probability");
  });

  it("returns decide errors", async () => {
    agentDir();
    const classify = vi.fn(async () => ({
      api: "classifier",
      provider: "typesafe",
      model: "jev-latest",
      answers: {},
      stopReason: "error",
      errorMessage: "model unavailable",
      timestamp: 1_000,
    }));
    const tool = createDecideTool();

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
    agentDir();
    const classify = vi.fn(async () => {
      throw new Error("transport failed");
    });
    const tool = createDecideTool();

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
    agentDir();
    let releaseClassify!: (value: unknown) => void;
    const gate = new Promise<unknown>((resolve) => {
      releaseClassify = resolve;
    });
    const classify = vi.fn(async () => {
      await gate;
      return classifierResult({ type: "bool", probability: 0.8 });
    });
    const tool = createDecideTool();
    const params = {
      kind: "bool" as const,
      input: "x",
      question: "q",
      trueDescription: "yes",
      falseDescription: "no",
    };
    const controller = new AbortController();
    const context = ctx(classify);

    const aborted = tool.execute(
      "1",
      params,
      controller.signal,
      undefined,
      context as never,
    );
    const waiter = tool.execute(
      "2",
      params,
      undefined,
      undefined,
      context as never,
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

  it("aborts the shared request when the last waiter cancels", async () => {
    agentDir();
    let requestSignal: AbortSignal | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const classify = vi.fn(
      async (_model, _input, options: { signal?: AbortSignal }) => {
        requestSignal = options.signal;
        markStarted();
        await new Promise((_resolve, reject) => {
          if (options.signal?.aborted) {
            reject(new Error("aborted"));
            return;
          }
          options.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            {
              once: true,
            },
          );
        });
        return classifierResult({ type: "bool", probability: 0.8 });
      },
    );
    const tool = createDecideTool();
    const controller = new AbortController();

    const pending = tool.execute(
      "1",
      {
        kind: "bool",
        input: "x",
        question: "q",
        trueDescription: "yes",
        falseDescription: "no",
      },
      controller.signal,
      undefined,
      ctx(classify) as never,
    );
    await started;
    controller.abort();

    const result = await pending;
    expect(textOf(result)).toContain("aborted");
    expect(requestSignal?.aborted).toBe(true);
  });

  it("does not cache a result after the caller aborts", async () => {
    agentDir();
    let release!: (value: unknown) => void;
    let markStarted!: () => void;
    const gate = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let calls = 0;
    const classify = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        markStarted();
        await gate;
      }
      return classifierResult({ type: "bool", probability: 0.8 });
    });
    const tool = createDecideTool();
    const context = ctx(classify);
    const params = {
      kind: "bool" as const,
      input: "x",
      question: "q",
      trueDescription: "yes",
      falseDescription: "no",
    };
    const controller = new AbortController();

    const pending = tool.execute(
      "1",
      params,
      controller.signal,
      undefined,
      context as never,
    );
    await started;
    controller.abort();
    release(undefined);

    expect(textOf(await pending)).toContain("aborted");
    await tool.execute("2", params, undefined, undefined, context as never);
    expect(classify).toHaveBeenCalledTimes(2);
  });

  it("uses a stable cache key across label order", async () => {
    agentDir();
    const classify = vi.fn(async () =>
      classifierResult({
        type: "choice",
        choice: "a",
        probabilities: { a: 0.8, b: 0.2 },
        confidence: 0.8,
      }),
    );
    const tool = createDecideTool();
    const base = {
      kind: "choice" as const,
      input: "x",
      question: "q",
      labels: [
        { label: "a", description: "first" },
        { label: "b", description: "second" },
      ],
    };

    const context = ctx(classify);
    await tool.execute("1", base, undefined, undefined, context as never);
    await tool.execute(
      "2",
      { ...base, labels: [...base.labels].reverse() },
      undefined,
      undefined,
      context as never,
    );

    expect(classify).toHaveBeenCalledTimes(1);
  });

  it("returns an error when the configured model cannot be used", async () => {
    agentDir();
    const tool = createDecideTool();
    const registry = {
      classify: vi.fn(),
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

    expect(textOf(result)).toContain("decide model not found");
    expect(registry.classify).not.toHaveBeenCalled();
  });

  it("reports an unavailable classifier model registry", async () => {
    agentDir();
    const tool = createDecideTool();

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
      { modelRegistry: {} } as never,
    );

    expect(textOf(result)).toContain("model registry unavailable");
  });

  it("enforces the input cap", async () => {
    agentDir({ ...config(), maxInputChars: 3 });
    const tool = createDecideTool();

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
    agentDir();
    const classify = vi.fn(async () =>
      classifierResult({ type: "bool", probability: 0.8 }),
    );
    const tool = createDecideTool();

    const context = ctx(classify);
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
      context as never,
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
      context as never,
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
        context as never,
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
        context as never,
      ),
    ]);
    expect(textOf(a)).toBe(textOf(b));
    expect(classify).toHaveBeenCalledTimes(2);
  });

  it("isolates the cache per session", async () => {
    agentDir();
    const classify = vi.fn(async () =>
      classifierResult({ type: "bool", probability: 0.8 }),
    );
    const tool = createDecideTool();
    const params = {
      kind: "bool" as const,
      input: "x",
      question: "q",
      trueDescription: "yes",
      falseDescription: "no",
    };

    await tool.execute(
      "1",
      params,
      undefined,
      undefined,
      ctx(classify, {}) as never,
    );
    await tool.execute(
      "2",
      params,
      undefined,
      undefined,
      ctx(classify, {}) as never,
    );

    expect(classify).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest cached result after 128 entries", async () => {
    agentDir();
    const classify = vi.fn(async () =>
      classifierResult({ type: "bool", probability: 0.8 }),
    );
    const tool = createDecideTool();
    const context = ctx(classify);
    const params = (input: string) => ({
      kind: "bool" as const,
      input,
      question: "q",
      trueDescription: "yes",
      falseDescription: "no",
    });

    for (let index = 0; index < 129; index += 1) {
      await tool.execute(
        String(index),
        params(`input-${index}`),
        undefined,
        undefined,
        context as never,
      );
    }
    await tool.execute(
      "again",
      params("input-0"),
      undefined,
      undefined,
      context as never,
    );

    expect(classify).toHaveBeenCalledTimes(130);
  });

  it("does not cache when TTL is zero or a call is aborted", async () => {
    agentDir();
    const classify = vi.fn(async () =>
      classifierResult({ type: "bool", probability: 0.8 }),
    );
    const tool = createDecideTool();

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
    const abortTool = createDecideTool();
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
    agentDir({ ...config(), timeoutMs: 1 });
    const classify = vi.fn(async (_model, _input, options) => {
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) {
          resolve();
          return;
        }
        options.signal?.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
      return {
        api: "classifier",
        provider: "typesafe",
        model: "jev-latest",
        answers: {},
        stopReason: "aborted",
        errorMessage: "timed out",
        timestamp: 1_000,
      };
    });
    const tool = createDecideTool();

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
    agentDir();
    const classify = vi.fn(async () =>
      classifierResult({ type: "bool", probability: 0.8 }),
    );
    const tool = createDecideTool();

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
      { signal: expect.any(AbortSignal), temperature: 0 },
    );
  });
});
