import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { parseJsonObject } from "@hollowheap/core/config";
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

export function ensureDefaultDecideConfig(agentDir?: string): void {
  let dir = agentDir;
  if (dir === undefined) {
    try {
      dir = getAgentDir();
    } catch {
      return;
    }
  }
  if (!dir) return;
  const decidePath = join(dir, "decide.json");
  const legacyPath = join(dir, "classifier.json");
  if (existsSync(decidePath) || existsSync(legacyPath)) return;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(decidePath, "{}\n", { flag: "wx", mode: 0o600 });
  } catch {
    // Best-effort; ignore EEXIST or read-only directories.
  }
}

function readConfiguredClassifierModel(
  agentDir: string | undefined,
): string | undefined {
  let dir = agentDir;
  if (dir === undefined) {
    try {
      dir = getAgentDir();
    } catch {
      return undefined;
    }
  }
  if (!dir) return undefined;

  for (const name of ["decide.json", "classifier.json"]) {
    const filePath = join(dir, name);
    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed = parseJsonObject(raw, filePath, []);
      if (isRecord(parsed) && typeof parsed.model === "string") {
        const trimmed = parsed.model.trim();
        if (trimmed !== "" && trimmed.includes("/")) {
          return trimmed;
        }
      }
      return undefined;
    } catch (error) {
      if ((error as { code?: unknown }).code !== "ENOENT") {
        return undefined;
      }
    }
  }
  return undefined;
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

export async function classifyToolCall(
  event: ToolCallEvent,
  tag: Tag | undefined,
  ctx: ExtensionContext,
  options: ClassifyToolCallOptions = {},
): Promise<ClassifierVerdict | undefined> {
  const registry = (ctx as { modelRegistry?: unknown }).modelRegistry as
    | {
        getModelOfType?: (...args: unknown[]) => unknown;
        findOfType?: (...args: unknown[]) => unknown;
        classify?: (...args: unknown[]) => Promise<unknown>;
      }
    | undefined;
  if (
    typeof registry?.classify !== "function" ||
    (typeof registry.getModelOfType !== "function" &&
      typeof registry.findOfType !== "function")
  ) {
    return undefined;
  }

  const configured = readConfiguredClassifierModel(options.agentDir);
  if (configured === undefined) return undefined;

  const slash = configured.indexOf("/");
  if (slash <= 0 || slash >= configured.length - 1) return undefined;
  const provider = configured.slice(0, slash);
  const id = configured.slice(slash + 1);

  let model: unknown;
  let modelId = configured;
  try {
    if (typeof registry.getModelOfType === "function") {
      model = registry.getModelOfType("classifier", provider, id);
    } else if (typeof registry.findOfType === "function") {
      model = registry.findOfType("classifier", provider, id);
    }
  } catch (error) {
    return {
      kind: "error",
      detail: errorMessage(error),
    };
  }
  if (model === undefined || model === null) return undefined;

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
