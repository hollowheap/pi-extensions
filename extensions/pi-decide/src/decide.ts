import { createHash } from "node:crypto";
import type {
  ClassifierAnswer,
  ClassifierContext,
  ClassifierQuestion,
  ClassifierResult,
  Usage,
} from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  type ExtensionContext as PiExtensionContext,
  defineTool,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  errorMessage,
  sanitizeTerminalText,
  stringifyToolJson,
  toolErrorResult,
  toolTextResult,
} from "@hollowheap/core/format";
import { isRecord } from "@hollowheap/core/records";
import { getSessionCache } from "@hollowheap/core/session-cache";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { appendSessionEntry } from "@hollowheap/core/state";
import { recordAuxiliaryUsage } from "@hollowheap/core/usage";
import { Type } from "typebox";
import { loadDecideConfig } from "./settings.js";

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

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isProbability(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

const MAX_CACHE_ENTRIES = 128;
const RESULT_CACHE_NAMESPACE = "pi-decide/results";
const INFLIGHT_CACHE_NAMESPACE = "pi-decide/inflight";

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

function recordBilledClassifierUsage(
  ctx: PiExtensionContext,
  modelId: string,
  usage: Usage,
  pi?: ExtensionAPI,
): void {
  const slash = modelId.indexOf("/");
  const provider = slash > 0 ? modelId.slice(0, slash) : "";
  const id = slash > 0 ? modelId.slice(slash + 1) : modelId;
  const modelObj = ctx.modelRegistry?.getModelOfType?.(
    "classifier",
    provider,
    id,
  );
  recordAuxiliaryUsage({
    sessionManager: ctx.sessionManager,
    context: ctx,
    modelId,
    model: modelObj,
    usage,
    appendEntry:
      pi !== undefined
        ? (customType, data) => {
            appendSessionEntry(pi, undefined, customType, data);
          }
        : undefined,
    emitEvent: (event, data) => {
      pi?.events?.emit?.(event, data);
    },
  });
}

interface Inflight {
  promise: Promise<DecideToolResult>;
  controller: AbortController;
  waiters: number;
  invalidated?: boolean;
}

export const DECIDE_STATS_TYPE = "hollowheap.decide";

interface DecideStats {
  totalCount: number;
  cacheHits: number;
  lastKind?: DecideKind;
}

const decideStats = new WeakMap<object, DecideStats>();
const persistedStatsCount = new WeakMap<object, number>();

function publishDecideStats(owner: object, stats: DecideStats): void {
  updateSessionSnapshot(
    owner,
    "decide",
    stats.totalCount > 0 ? { ...stats, updatedAt: Date.now() } : undefined,
  );
}

/** Persist accumulated decide stats as a branch custom entry when dirty or forced. */
export function persistDecideStats(
  owner: object,
  pi?: Pick<ExtensionAPI, "appendEntry">,
  force = false,
): void {
  const stats = decideStats.get(owner);
  if (!stats || stats.totalCount <= 0) return;
  if (!force && (persistedStatsCount.get(owner) ?? 0) >= stats.totalCount) {
    return;
  }
  if (
    appendSessionEntry(pi, owner, DECIDE_STATS_TYPE, {
      totalCount: stats.totalCount,
      cacheHits: stats.cacheHits,
      ...(stats.lastKind ? { lastKind: stats.lastKind } : {}),
      updatedAt: Date.now(),
    })
  ) {
    persistedStatsCount.set(owner, stats.totalCount);
  }
}

/** Rebuild decide stats from the latest persisted stats entry on the branch. */
export function restoreDecideStats(
  owner: object,
  entries: readonly unknown[],
): void {
  let stats: DecideStats = { totalCount: 0, cacheHits: 0 };
  for (const entry of entries) {
    const record = entry as {
      type?: unknown;
      customType?: unknown;
      data?: { totalCount?: unknown; cacheHits?: unknown; lastKind?: unknown };
    };
    if (record.type !== "custom" || record.customType !== DECIDE_STATS_TYPE) {
      continue;
    }
    const data = record.data;
    if (
      typeof data?.totalCount !== "number" ||
      typeof data.cacheHits !== "number"
    ) {
      continue;
    }
    stats = { totalCount: data.totalCount, cacheHits: data.cacheHits };
    if (
      data.lastKind === "choice" ||
      data.lastKind === "score" ||
      data.lastKind === "bool"
    ) {
      stats.lastKind = data.lastKind;
    }
  }
  decideStats.set(owner, stats);
  persistedStatsCount.set(owner, stats.totalCount);
  publishDecideStats(owner, stats);
}

export function createDecideTool(pi?: ExtensionAPI) {
  const fallbackOwner = {};

  function ownerFor(ctx: PiExtensionContext): object {
    return typeof ctx.sessionManager === "object" && ctx.sessionManager !== null
      ? ctx.sessionManager
      : fallbackOwner;
  }

  function recordDecide(
    ctx: PiExtensionContext,
    kind: DecideKind,
    cacheHit: boolean,
  ): void {
    const owner = ownerFor(ctx);
    const prev = decideStats.get(owner) ?? { totalCount: 0, cacheHits: 0 };
    const next: DecideStats = {
      totalCount: prev.totalCount + 1,
      cacheHits: prev.cacheHits + (cacheHit ? 1 : 0),
      lastKind: kind,
    };
    decideStats.set(owner, next);
    publishDecideStats(owner, next);
  }

  function cacheKey(
    model: string,
    params: DecideParams,
    question: ClassifierQuestion,
  ): string {
    return createHash("sha256")
      .update(
        stableStringify([
          model,
          params.kind,
          params.question,
          question,
          params.input,
        ]),
      )
      .digest("hex");
  }

  async function waitForResult(
    entry: Inflight,
    signal: AbortSignal | undefined,
  ): Promise<DecideToolResult> {
    if (signal === undefined) {
      entry.waiters += 1;
      try {
        return await entry.promise;
      } finally {
        entry.waiters -= 1;
      }
    }
    if (signal.aborted) return errorResult("aborted");

    entry.waiters += 1;
    return new Promise((resolve) => {
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        entry.waiters -= 1;
        if (entry.waiters === 0) {
          entry.invalidated = true;
          entry.controller.abort();
        }
        resolve(errorResult("aborted"));
      };
      const finish = (result: DecideToolResult) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        entry.waiters -= 1;
        resolve(result);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      entry.promise.then(finish, (error) =>
        finish(errorResult(errorMessage(error))),
      );
    });
  }

  return defineTool({
    name: "decide",
    label: "decide",
    description:
      "Ask the configured decide model one advisory question. Kinds: choice, score, bool. Input is sent to the decide model; do not include secrets.",
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
    execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return executeDecide(params as DecideParams, ctx, signal);
    },
  });

  async function executeDecide(
    params: DecideParams,
    ctx: PiExtensionContext,
    signal: AbortSignal | undefined,
  ): Promise<DecideToolResult> {
    if (signal?.aborted) {
      return errorResult("aborted");
    }
    const config = loadDecideConfig(getAgentDir());
    if (config.model === undefined) {
      return errorResult("decide model is not configured in decide.json");
    }
    if (params.input.length > config.maxInputChars) {
      return errorResult(`input exceeds ${config.maxInputChars} characters`);
    }
    if (params.input.trim() === "") {
      return errorResult("input is required");
    }
    if (params.question.trim() === "") {
      return errorResult("question is required");
    }

    const question = buildQuestion(params);
    if (typeof question === "string") {
      return errorResult(question);
    }

    const owner = ownerFor(ctx);
    const results = getSessionCache<DecideToolResult>(
      owner,
      RESULT_CACHE_NAMESPACE,
      { maxEntries: MAX_CACHE_ENTRIES },
    );
    const inflight = getSessionCache<Inflight>(
      owner,
      INFLIGHT_CACHE_NAMESPACE,
      { maxEntries: MAX_CACHE_ENTRIES },
    );
    const key = cacheKey(config.model, params, question);
    const cached = results.get(key);
    if (cached !== undefined) {
      recordDecide(ctx, params.kind, true);
      if (cached.details.error !== undefined) {
        return cached;
      }
      const hasUsage =
        cached.usage !== undefined || cached.details.usage !== undefined;
      if (!hasUsage) {
        return cached;
      }
      const details = { ...cached.details, usage: ZERO_USAGE };
      return {
        ...toolTextResult(stringifyToolJson(details), details),
        usage: ZERO_USAGE,
      };
    }
    const existing = inflight.get(key);
    if (existing !== undefined && existing.invalidated !== true) {
      recordDecide(ctx, params.kind, true);
      const result = await waitForResult(existing, signal);
      if (result.details.error !== undefined) {
        return result;
      }
      const hasUsage =
        result.usage !== undefined || result.details.usage !== undefined;
      if (!hasUsage) {
        return result;
      }
      const details = { ...result.details, usage: ZERO_USAGE };
      return {
        ...toolTextResult(stringifyToolJson(details), details),
        usage: ZERO_USAGE,
      };
    }

    recordDecide(ctx, params.kind, false);
    const controller = new AbortController();
    const requestSignal = AbortSignal.any([
      AbortSignal.timeout(config.timeoutMs),
      controller.signal,
    ]);
    const task = (async (): Promise<DecideToolResult> => {
      let result: ClassifierResult;
      try {
        result = await defaultDecide(
          ctx,
          config.model as string,
          { state: { input: params.input }, questions: { answer: question } },
          requestSignal,
        );
      } catch (error) {
        return errorResult(errorMessage(error));
      }
      if (result.usage !== undefined) {
        recordBilledClassifierUsage(
          ctx,
          config.model as string,
          result.usage,
          pi,
        );
      }
      if (result.stopReason !== "stop") {
        return errorResult(result.errorMessage ?? "decide failed");
      }
      const answer = result.answers?.answer;
      if (answer === undefined) {
        return errorResult("decide returned no answer");
      }
      if (answer.type !== params.kind) {
        return errorResult(
          `decide returned ${answer.type} for a ${params.kind} question`,
        );
      }

      const output = normalize(
        answer,
        params,
        config.model as string,
        result.usage,
      );
      if (typeof output === "string") {
        return errorResult(output);
      }
      return {
        ...toolTextResult(stringifyToolJson(output), output),
        ...(result.usage === undefined ? {} : { usage: result.usage }),
      };
    })();

    const entry: Inflight = { promise: task, controller, waiters: 0 };
    inflight.set(key, entry);
    void task
      .finally(() => {
        if (inflight.get(key) === entry) inflight.delete(key);
      })
      .catch(() => {});

    const result = await waitForResult(entry, signal);
    if (signal?.aborted) {
      return errorResult("aborted");
    }
    if (config.cacheTtlMs > 0 && result.details.error === undefined) {
      results.set(key, result, config.cacheTtlMs);
    }
    return result;
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
      const criteria: Record<string, string> = Object.create(null);
      const seen = new Set<string>();
      for (const label of params.labels) {
        if (
          typeof label.label !== "string" ||
          label.label.trim() === "" ||
          typeof label.description !== "string" ||
          label.description.trim() === ""
        ) {
          return "choice labels and descriptions must be non-empty";
        }
        if (seen.has(label.label)) {
          return "choice labels must be unique";
        }
        seen.add(label.label);
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
      const seen = new Set<string>();
      for (const label of params.labels) {
        if (
          typeof label.label !== "string" ||
          label.label.trim() === "" ||
          typeof label.description !== "string" ||
          label.description.trim() === ""
        ) {
          return "score labels and descriptions must be non-empty";
        }
        if (seen.has(label.label)) {
          return "score labels must be unique";
        }
        seen.add(label.label);
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
    params: DecideParams,
    model: string,
    usage: ClassifierResult["usage"],
  ): Record<string, unknown> | string {
    const kind = params.kind;
    if (answer.type === "choice") {
      const labels = new Set((params.labels ?? []).map((label) => label.label));
      if (!labels.has(answer.choice)) {
        return `decide returned unknown choice "${sanitizeTerminalText(answer.choice)}"`;
      }
      if (!isRecord(answer.probabilities)) {
        return "decide returned invalid probabilities";
      }
      const probabilities = Object.entries(answer.probabilities);
      if (probabilities.length === 0) {
        return "decide returned empty probabilities";
      }
      for (const [label, probability] of probabilities) {
        if (!labels.has(label) || !isProbability(probability)) {
          return "decide returned invalid probabilities";
        }
      }
      if (!isProbability(answer.confidence)) {
        return "decide returned invalid confidence";
      }
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
      if (
        !Number.isInteger(answer.score) ||
        answer.score < 0 ||
        answer.score >= (params.labels?.length ?? 0)
      ) {
        return `decide returned out-of-range score ${answer.score}`;
      }
      if (!isProbability(answer.confidence)) {
        return "decide returned invalid confidence";
      }
      const label = params.labels?.[answer.score]?.label;
      if (label === undefined) {
        return `decide returned out-of-range score ${answer.score}`;
      }
      return {
        kind,
        value: answer.score,
        label,
        confidence: answer.confidence,
        model,
        usage,
      };
    }
    if (!isProbability(answer.probability)) {
      return "decide returned invalid probability";
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
    return toolErrorResult("decide unavailable", message);
  }
}

type DecideToolResult = {
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
  usage?: Usage;
};

export function defaultDecide(
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
      errorMessage: `decide model must be "provider/model-id": ${modelId}`,
      timestamp: Date.now(),
    });
  }
  const provider = modelId.slice(0, slash);
  const id = modelId.slice(slash + 1);
  const registry = ctx.modelRegistry;
  if (
    typeof registry?.getModelOfType !== "function" ||
    typeof registry?.classify !== "function"
  ) {
    return Promise.resolve({
      api: "classifier",
      provider,
      model: id,
      answers: {},
      stopReason: "error",
      errorMessage: "decide model registry unavailable",
      timestamp: Date.now(),
    });
  }
  const model = registry.getModelOfType("classifier", provider, id);
  if (model === undefined) {
    return Promise.resolve({
      api: "classifier",
      provider,
      model: id,
      answers: {},
      stopReason: "error",
      errorMessage: `decide model not found: ${modelId}`,
      timestamp: Date.now(),
    });
  }
  return registry.classify(model, input, {
    signal,
    temperature: 0,
  });
}
