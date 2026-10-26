import { Type } from "@earendil-works/pi-ai";
import type {
  ClassifierAnswer,
  ClassifierContext,
  ClassifierQuestion,
  ClassifierResult,
} from "@earendil-works/pi-ai";
import type { ExtensionContext as PiExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { loadClassifierConfig } from "./config.js";

export type DecideKind = "choice" | "score" | "bool";

export interface DecideLabel {
  label: string;
  description: string;
}

export interface DecideParams {
  kind: DecideKind;
  input: string;
  question: string;
  labels?: DecideLabel[];
  trueDescription?: string;
  falseDescription?: string;
}

export interface DecideDeps {
  loadConfig: () => ReturnType<typeof loadClassifierConfig>;
  getAgentDir: () => string;
  classify: (
    ctx: PiExtensionContext,
    modelId: string,
    input: ClassifierContext,
    signal: AbortSignal | undefined,
  ) => Promise<ClassifierResult>;
}

const defaultDeps: DecideDeps = {
  loadConfig: () => loadClassifierConfig(getAgentDir()),
  getAgentDir: () => "/nonexistent-pi-agent-dir-for-tests",
  classify: defaultClassify,
};

export const decideTool = createDecideTool();

export function createDecideTool(overrides: Partial<DecideDeps> = {}) {
  const deps: DecideDeps = { ...defaultDeps, ...overrides };
  const cache = new Map<
    string,
    { result: DecideToolResult; expires: number }
  >();
  const inflight = new Map<string, Promise<DecideToolResult>>();

  return defineTool({
    name: "decide",
    label: "decide",
    description:
      "Ask the configured classifier one advisory question. Kinds: choice, score, bool. Input is sent to the classifier; do not include secrets.",
    exposure: "direct",
    parameters: Type.Object({
      kind: Type.Union([
        Type.Literal("choice"),
        Type.Literal("score"),
        Type.Literal("bool"),
      ]),
      input: Type.String({ minLength: 1 }),
      question: Type.String({ minLength: 1 }),
      labels: Type.Optional(
        Type.Array(
          Type.Object({
            label: Type.String({ minLength: 1 }),
            description: Type.String({ minLength: 1 }),
          }),
          { minItems: 2, maxItems: 10 },
        ),
      ),
      trueDescription: Type.Optional(
        Type.String({ minLength: 1, description: "Meaning of true" }),
      ),
      falseDescription: Type.Optional(
        Type.String({ minLength: 1, description: "Meaning of false" }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return executeDecide(params as DecideParams, ctx, deps, signal);
    },
  });

  async function executeDecide(
    params: DecideParams,
    ctx: PiExtensionContext,
    deps: DecideDeps,
    signal: AbortSignal | undefined,
  ): Promise<DecideToolResult> {
    const config = deps.loadConfig();
    if (config.model === undefined) {
      return errorResult(
        "classifier model is not configured in classifier.json",
      );
    }
    if (params.input.length > config.maxInputChars) {
      return errorResult(`input exceeds ${config.maxInputChars} characters`);
    }
    if (params.input.trim() === "") {
      return errorResult("input is required");
    }

    const question = buildQuestion(params);
    if (typeof question === "string") {
      return errorResult(question);
    }

    const key = JSON.stringify([
      config.model,
      params.kind,
      params.question,
      question,
      params.input,
    ]);
    const cached = cache.get(key);
    if (cached !== undefined && cached.expires > Date.now()) {
      return cached.result;
    }
    const existing = inflight.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const task = (async (): Promise<DecideToolResult> => {
      const timeout =
        signal === undefined
          ? AbortSignal.timeout(config.timeoutMs)
          : AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]);
      const result = await deps.classify(
        ctx,
        config.model as string,
        { state: { input: params.input }, questions: { answer: question } },
        timeout,
      );
      if (result.stopReason !== "stop") {
        return errorResult(result.errorMessage ?? "classifier failed");
      }
      const answer = result.answers.answer;
      if (answer === undefined) {
        return errorResult("classifier returned no answer");
      }
      if (answer.type !== params.kind) {
        return errorResult(
          `classifier returned ${answer.type} for a ${params.kind} question`,
        );
      }

      const output = normalize(
        answer,
        params.kind,
        config.model as string,
        result.usage,
      );
      const toolResult = {
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
        details: output,
      };
      if (signal?.aborted) {
        return errorResult("aborted");
      }
      if (config.cacheTtlMs > 0) {
        cache.set(key, {
          result: toolResult,
          expires: Date.now() + config.cacheTtlMs,
        });
      }
      return toolResult;
    })();

    inflight.set(key, task);
    try {
      return await task;
    } finally {
      inflight.delete(key);
    }
  }

  function buildQuestion(params: DecideParams): ClassifierQuestion | string {
    if (params.kind === "choice") {
      if (
        !Array.isArray(params.labels) ||
        params.labels.length < 2 ||
        params.labels.length > 10
      ) {
        return "choice requires 2-10 labels";
      }
      const criteria: Record<string, string> = {};
      for (const label of params.labels) {
        if (
          typeof label.label !== "string" ||
          label.label.trim() === "" ||
          typeof label.description !== "string" ||
          label.description.trim() === ""
        ) {
          return "choice labels and descriptions must be non-empty";
        }
        criteria[label.label] = label.description;
      }
      return {
        type: "choice",
        instructions: params.question,
        criteria,
      };
    }
    if (params.kind === "score") {
      if (
        !Array.isArray(params.labels) ||
        params.labels.length < 2 ||
        params.labels.length > 10
      ) {
        return "score requires 2-10 scale levels";
      }
      const criteria: string[] = [];
      for (const label of params.labels) {
        if (
          typeof label.label !== "string" ||
          label.label.trim() === "" ||
          typeof label.description !== "string" ||
          label.description.trim() === ""
        ) {
          return "score labels and descriptions must be non-empty";
        }
        criteria.push(`${label.label}: ${label.description}`);
      }
      return {
        type: "score",
        instructions: params.question,
        criteria,
      };
    }
    if (
      typeof params.trueDescription !== "string" ||
      params.trueDescription.trim() === "" ||
      typeof params.falseDescription !== "string" ||
      params.falseDescription.trim() === ""
    ) {
      return "bool requires true and false descriptions";
    }
    return {
      type: "bool",
      instructions: params.question,
      criteria: {
        true: params.trueDescription,
        false: params.falseDescription,
      },
    };
  }

  function normalize(
    answer: ClassifierAnswer,
    kind: DecideKind,
    model: string,
    usage: ClassifierResult["usage"],
  ): Record<string, unknown> {
    if (answer.type === "choice") {
      return {
        kind,
        value: answer.choice,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
        model,
        usage,
      };
    }
    if (answer.type === "score") {
      return {
        kind,
        value: answer.score,
        confidence: answer.confidence,
        model,
        usage,
      };
    }
    return {
      kind,
      value: answer.probability >= 0.5,
      probability: answer.probability,
      model,
      usage,
    };
  }

  function errorResult(message: string): DecideToolResult {
    return {
      content: [{ type: "text", text: `decide unavailable: ${message}` }],
      details: { error: message },
    };
  }
}

type DecideToolResult = {
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
};

export function defaultClassify(
  ctx: PiExtensionContext,
  modelId: string,
  input: ClassifierContext,
  signal: AbortSignal | undefined,
): Promise<ClassifierResult> {
  const slash = modelId.indexOf("/");
  if (slash <= 0 || slash === modelId.length - 1) {
    return Promise.resolve({
      api: "classifier",
      provider: "",
      model: modelId,
      answers: {},
      stopReason: "error",
      errorMessage: `classifier model must be "provider/model-id": ${modelId}`,
      timestamp: Date.now(),
    });
  }
  const provider = modelId.slice(0, slash);
  const id = modelId.slice(slash + 1);
  const model = ctx.modelRegistry.getModelOfType("classifier", provider, id);
  if (model === undefined) {
    return Promise.resolve({
      api: "classifier",
      provider,
      model: id,
      answers: {},
      stopReason: "error",
      errorMessage: `classifier model not found: ${modelId}`,
      timestamp: Date.now(),
    });
  }
  return ctx.modelRegistry.classify(model, input, {
    signal,
    temperature: 0,
  });
}
