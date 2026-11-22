import type {
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  ensureDefaultDecideConfig as ensureCoreDefaultDecideConfig,
  loadDecideConfig,
} from "@hollowheap/core/classifier";
import { errorMessage } from "@hollowheap/core/format";
import { isRecord } from "@hollowheap/core/records";
import type { Tag } from "@hollowheap/core/types";
import { recordAuxiliaryUsage } from "@hollowheap/core/usage";
import { readCommandArg, readToolTarget } from "./targets.js";

export type ClassifierVerdict =
  | { kind: "block" }
  | { kind: "error"; detail: string };

export interface ClassifyToolCallOptions {
  agentDir?: string;
  appendEntry?: (customType: string, data: unknown) => void;
  emitEvent?: (event: string, data?: unknown) => void;
}

function resolveAgentDir(agentDir: string | undefined): string | undefined {
  if (agentDir !== undefined) return agentDir || undefined;
  try {
    return getAgentDir() || undefined;
  } catch {
    return undefined;
  }
}

export function ensureDefaultDecideConfig(agentDir?: string): void {
  const dir = resolveAgentDir(agentDir);
  if (!dir) return;
  ensureCoreDefaultDecideConfig(dir);
}

function readConfiguredClassifierModel(
  agentDir: string | undefined,
): string | undefined {
  const dir = resolveAgentDir(agentDir);
  if (!dir) return undefined;
  return loadDecideConfig(dir).model;
}

function hasPositiveUsage(usage: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost?: { total?: number };
}): boolean {
  return (
    usage.input > 0 ||
    usage.output > 0 ||
    usage.cacheRead > 0 ||
    usage.cacheWrite > 0 ||
    (typeof usage.cost?.total === "number" && usage.cost.total > 0)
  );
}

type ClassifierRegistry = {
  getModelOfType?: (...args: unknown[]) => unknown;
  findOfType?: (...args: unknown[]) => unknown;
  getModelsOfType?: (...args: unknown[]) => unknown;
  classify?: (...args: unknown[]) => Promise<unknown>;
};

type ResolvedClassifierModel =
  | { model: unknown; modelId: string }
  | { error: string };

function resolveClassifierModel(
  ctx: ExtensionContext,
  agentDir?: string,
): ResolvedClassifierModel | undefined {
  const registry = (ctx as { modelRegistry?: unknown }).modelRegistry as
    | ClassifierRegistry
    | undefined;
  if (typeof registry?.classify !== "function") return undefined;
  const configured = readConfiguredClassifierModel(agentDir);
  if (configured === undefined) return undefined;

  const candidates: Array<{ provider: string; id: string }> = [];
  const slash = configured.indexOf("/");
  if (slash > 0 && slash < configured.length - 1) {
    candidates.push({
      provider: configured.slice(0, slash),
      id: configured.slice(slash + 1),
    });
  }
  try {
    const all =
      typeof registry.getModelsOfType === "function"
        ? registry.getModelsOfType("classifier")
        : [];
    if (Array.isArray(all)) {
      for (const item of all) {
        if (!isRecord(item)) continue;
        const id = typeof item.id === "string" ? item.id : "";
        const provider = typeof item.provider === "string" ? item.provider : "";
        if (
          id === configured ||
          (provider !== "" && `${provider}/${id}` === configured)
        ) {
          candidates.push({ provider, id });
        }
      }
    }
  } catch {
    // Registry probing is best effort.
  }

  let lastError: string | undefined;
  for (const { provider, id } of candidates) {
    try {
      const model =
        typeof registry.getModelOfType === "function"
          ? registry.getModelOfType("classifier", provider, id)
          : typeof registry.findOfType === "function"
            ? registry.findOfType("classifier", provider, id)
            : undefined;
      if (model === undefined || model === null) continue;
      let modelId = configured;
      if (
        isRecord(model) &&
        typeof model.id === "string" &&
        model.id.trim() !== ""
      ) {
        modelId =
          typeof model.provider === "string" &&
          model.provider.trim() !== "" &&
          !model.id.includes("/")
            ? `${model.provider.trim()}/${model.id.trim()}`
            : model.id.trim();
      }
      return { model, modelId };
    } catch (error) {
      lastError = errorMessage(error);
    }
  }
  return lastError === undefined ? undefined : { error: lastError };
}

export function hasAvailableClassifierModel(
  ctx: ExtensionContext,
  agentDir?: string,
): boolean {
  const resolved = resolveClassifierModel(ctx, agentDir);
  return resolved !== undefined && "model" in resolved;
}

export async function classifyToolCall(
  event: ToolCallEvent,
  tag: Tag | undefined,
  ctx: ExtensionContext,
  options: ClassifyToolCallOptions = {},
): Promise<ClassifierVerdict | undefined> {
  const registry = (ctx as { modelRegistry?: unknown }).modelRegistry as
    | ClassifierRegistry
    | undefined;
  if (typeof registry?.classify !== "function") return undefined;

  const resolved = resolveClassifierModel(ctx, options.agentDir);
  if (resolved === undefined) return undefined;
  if ("error" in resolved) return { kind: "error", detail: resolved.error };
  const { model, modelId } = resolved;

  const rawTarget =
    tag === "shell"
      ? readCommandArg(event.input)
      : readToolTarget(event.toolName, event.input);
  const target =
    rawTarget !== undefined && rawTarget !== "" ? rawTarget : event.toolName;
  const payload = {
    state: {
      tool: event.toolName,
      tag: tag ?? "unknown",
      summary: target.slice(0, 80),
    },
    questions: {
      answer: {
        type: "choice",
        instructions: `Allow ${event.toolName} (${tag ?? "unknown"})?`,
        criteria: {
          allow: "Proceed with the standard guard decision",
          block: "Block this tool call",
        },
      },
    },
  };

  let result: unknown;
  try {
    result = await registry.classify(model, payload);
  } catch (error) {
    return {
      kind: "error",
      detail: errorMessage(error),
    };
  }
  const record = result as
    | {
        stopReason?: unknown;
        errorMessage?: unknown;
        answers?: Record<string, unknown>;
        usage?: unknown;
      }
    | undefined;

  if (isRecord(record?.usage)) {
    const rawUsage = record.usage;
    const usage = {
      input:
        typeof rawUsage.input === "number" && Number.isFinite(rawUsage.input)
          ? rawUsage.input
          : 0,
      output:
        typeof rawUsage.output === "number" && Number.isFinite(rawUsage.output)
          ? rawUsage.output
          : 0,
      cacheRead:
        typeof rawUsage.cacheRead === "number" &&
        Number.isFinite(rawUsage.cacheRead)
          ? rawUsage.cacheRead
          : 0,
      cacheWrite:
        typeof rawUsage.cacheWrite === "number" &&
        Number.isFinite(rawUsage.cacheWrite)
          ? rawUsage.cacheWrite
          : 0,
      ...(isRecord(rawUsage.cost) && typeof rawUsage.cost.total === "number"
        ? { cost: { total: rawUsage.cost.total } }
        : {}),
    };
    if (
      hasPositiveUsage(usage) &&
      (ctx.sessionManager !== undefined || options.appendEntry !== undefined)
    ) {
      recordAuxiliaryUsage({
        sessionManager: ctx.sessionManager,
        context: ctx,
        modelId,
        model,
        usage,
        appendEntry: options.appendEntry,
        emitEvent: options.emitEvent,
      });
    }
  }

  if (record?.stopReason === "error" || record?.stopReason === "aborted") {
    return {
      kind: "error",
      detail:
        typeof record.errorMessage === "string"
          ? record.errorMessage
          : String(record.stopReason),
    };
  }
  const answer = record?.answers?.answer;
  const choice =
    typeof answer === "string"
      ? answer
      : (answer as { choice?: unknown } | undefined)?.choice;
  return choice === "block" ? { kind: "block" } : undefined;
}
