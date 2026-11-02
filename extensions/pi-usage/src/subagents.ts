import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { calculateDollarCost, resolveModelPricing } from "@hollowheap/core";
import type { CumulativeUsage, ModelUsage } from "./index.js";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export interface SubagentUsage {
  id: string;
  agent: string;
  model: string;
  status: string;
  available: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
  byModel: Record<string, ModelUsage>;
}

interface UsageTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function emptySubagent(
  id: string,
  agent: string,
  model: string,
  status: string,
  available: boolean,
): SubagentUsage {
  return {
    id,
    agent,
    model,
    status,
    available,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    cost: 0,
    byModel: {},
  };
}

function readMessageUsage(
  usage: unknown,
  model: string,
): UsageTokens | undefined {
  if (!isRecord(usage)) return undefined;
  if (
    typeof usage.input !== "number" ||
    typeof usage.output !== "number" ||
    !Number.isFinite(usage.input) ||
    !Number.isFinite(usage.output)
  ) {
    return undefined;
  }
  const input = Math.max(0, usage.input);
  const output = Math.max(0, usage.output);
  const cacheRead = numberOrZero(usage.cacheRead);
  const cacheWrite = numberOrZero(usage.cacheWrite);
  const costObject = isRecord(usage.cost) ? usage.cost : undefined;
  let cost = numberOrZero(costObject?.total);
  if (cost === 0) {
    const pricing = resolveModelPricing(model);
    if (pricing) {
      cost = calculateDollarCost(
        { input, output, cacheRead, cacheWrite },
        pricing,
      );
    }
  }
  return { input, output, cacheRead, cacheWrite, cost };
}

function addModelUsage(
  byModel: Record<string, ModelUsage>,
  model: string,
  usage: UsageTokens,
): void {
  const previous = byModel[model] ?? {
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
  };
  byModel[model] = {
    model,
    inputTokens: previous.inputTokens + usage.input,
    outputTokens: previous.outputTokens + usage.output,
    cacheReadTokens: previous.cacheReadTokens + usage.cacheRead,
    cacheWriteTokens: previous.cacheWriteTokens + usage.cacheWrite,
    cost: previous.cost + usage.cost,
  };
}

function readCustomUsage(data: unknown):
  | {
      tokens: UsageTokens;
      byModel: Record<string, ModelUsage>;
    }
  | undefined {
  if (!isRecord(data)) return undefined;
  if (
    typeof data.inputTokens !== "number" ||
    typeof data.outputTokens !== "number" ||
    typeof data.totalCost !== "number"
  ) {
    return undefined;
  }
  const byModel: Record<string, ModelUsage> = {};
  if (isRecord(data.byModel)) {
    for (const [key, raw] of Object.entries(data.byModel)) {
      if (!isRecord(raw)) continue;
      if (
        typeof raw.inputTokens !== "number" ||
        typeof raw.outputTokens !== "number"
      ) {
        continue;
      }
      byModel[key] = {
        model: typeof raw.model === "string" ? raw.model : key,
        inputTokens: numberOrZero(raw.inputTokens),
        outputTokens: numberOrZero(raw.outputTokens),
        cacheReadTokens: numberOrZero(raw.cacheReadTokens),
        cacheWriteTokens: numberOrZero(raw.cacheWriteTokens),
        cost: numberOrZero(raw.cost),
      };
    }
  }
  return {
    tokens: {
      input: numberOrZero(data.inputTokens),
      output: numberOrZero(data.outputTokens),
      cacheRead: numberOrZero(data.cacheReadTokens),
      cacheWrite: numberOrZero(data.cacheWriteTokens),
      cost: numberOrZero(data.totalCost),
    },
    byModel,
  };
}

function readChildUsage(
  sessionPath: string,
  fallbackModel: string,
):
  | Pick<
      SubagentUsage,
      | "inputTokens"
      | "outputTokens"
      | "cacheReadTokens"
      | "cacheWriteTokens"
      | "totalTokens"
      | "cost"
      | "byModel"
    >
  | undefined {
  let raw: string;
  try {
    raw = readFileSync(resolve(sessionPath), "utf8");
  } catch {
    return undefined;
  }
  const entries: unknown[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // A partial final JSONL line is ignored.
    }
  }

  let latestCustom:
    | { tokens: UsageTokens; byModel: Record<string, ModelUsage> }
    | undefined;
  const byModel: Record<string, ModelUsage> = {};
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;

  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (entry.customType === "hollowheap.usage") {
      const custom = readCustomUsage(entry.data);
      if (custom) latestCustom = custom;
      continue;
    }
    if (entry.type === "message") {
      const message = entry.message;
      if (!isRecord(message) || message.role !== "assistant") continue;
      const model =
        typeof message.model === "string" ? message.model : fallbackModel;
      const parsed = readMessageUsage(message.usage, model);
      if (!parsed) continue;
      input += parsed.input;
      output += parsed.output;
      cacheRead += parsed.cacheRead;
      cacheWrite += parsed.cacheWrite;
      cost += parsed.cost;
      addModelUsage(byModel, model, parsed);
      continue;
    }
    if (entry.type === "usage") {
      const model =
        typeof entry.model === "string" ? entry.model : fallbackModel;
      const parsed = readMessageUsage(entry.usage, model);
      if (!parsed) continue;
      input += parsed.input;
      output += parsed.output;
      cacheRead += parsed.cacheRead;
      cacheWrite += parsed.cacheWrite;
      cost += parsed.cost;
      addModelUsage(byModel, model, parsed);
    }
  }

  if (latestCustom) {
    return {
      inputTokens: latestCustom.tokens.input,
      outputTokens: latestCustom.tokens.output,
      cacheReadTokens: latestCustom.tokens.cacheRead,
      cacheWriteTokens: latestCustom.tokens.cacheWrite,
      totalTokens:
        latestCustom.tokens.input +
        latestCustom.tokens.output +
        latestCustom.tokens.cacheRead +
        latestCustom.tokens.cacheWrite,
      cost: latestCustom.tokens.cost,
      byModel: latestCustom.byModel,
    };
  }
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost,
    byModel,
  };
}

function readByModel(value: unknown): Record<string, ModelUsage> {
  if (!isRecord(value)) return {};
  const byModel: Record<string, ModelUsage> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    byModel[key] = {
      model: typeof raw.model === "string" ? raw.model : key,
      inputTokens: numberOrZero(raw.inputTokens),
      outputTokens: numberOrZero(raw.outputTokens),
      cacheReadTokens: numberOrZero(raw.cacheReadTokens),
      cacheWriteTokens: numberOrZero(raw.cacheWriteTokens),
      cost: numberOrZero(raw.cost),
    };
  }
  return byModel;
}

export function readSubagentUsageSnapshot(value: unknown): SubagentUsage[] {
  if (!Array.isArray(value)) return [];
  const rows: SubagentUsage[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    if (
      typeof raw.id !== "string" ||
      typeof raw.agent !== "string" ||
      typeof raw.model !== "string" ||
      typeof raw.status !== "string" ||
      typeof raw.available !== "boolean"
    ) {
      continue;
    }
    const byModel = readByModel(raw.byModel);
    rows.push({
      id: raw.id,
      agent: raw.agent,
      model: raw.model,
      status: raw.status,
      available: raw.available,
      inputTokens: numberOrZero(raw.inputTokens),
      outputTokens: numberOrZero(raw.outputTokens),
      cacheReadTokens: numberOrZero(raw.cacheReadTokens),
      cacheWriteTokens: numberOrZero(raw.cacheWriteTokens),
      totalTokens: numberOrZero(raw.totalTokens),
      cost: numberOrZero(raw.cost),
      byModel,
    });
  }
  return rows;
}

export function scanSubagentUsage(
  agentDir: string,
  parentSession: string,
): SubagentUsage[] {
  const dir = join(agentDir, "subagents");
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const rows: SubagentUsage[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.endsWith(".runner.json")) continue;
    let state: unknown;
    try {
      state = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch {
      continue;
    }
    if (!isRecord(state)) continue;
    if (state.parentSession !== parentSession) continue;
    if (
      typeof state.status !== "string" ||
      !TERMINAL_STATUSES.has(state.status)
    ) {
      continue;
    }
    const id = typeof state.id === "string" ? state.id : name.slice(0, -5);
    const agent = typeof state.agent === "string" ? state.agent : "unknown";
    const model = typeof state.model === "string" ? state.model : "unknown";
    const harness = typeof state.harness === "string" ? state.harness : "pi";
    const row = emptySubagent(id, agent, model, state.status, true);
    if (
      harness !== "pi" ||
      typeof state.session !== "string" ||
      state.session === ""
    ) {
      row.available = false;
      rows.push(row);
      continue;
    }
    const child = readChildUsage(state.session, model);
    if (!child) {
      row.available = false;
      rows.push(row);
      continue;
    }
    rows.push({ ...row, ...child });
  }
  rows.sort((left, right) => left.id.localeCompare(right.id));
  return rows;
}

export function combineUsage(
  parent: CumulativeUsage,
  subagents: readonly SubagentUsage[],
): CumulativeUsage {
  const combined: CumulativeUsage = {
    ...parent,
    byModel: { ...parent.byModel },
  };
  for (const row of subagents) {
    if (!row.available) continue;
    combined.inputTokens += row.inputTokens;
    combined.outputTokens += row.outputTokens;
    combined.cacheReadTokens += row.cacheReadTokens;
    combined.cacheWriteTokens += row.cacheWriteTokens;
    combined.totalTokens += row.totalTokens;
    combined.totalCost += row.cost;
    const models =
      Object.keys(row.byModel).length > 0
        ? Object.values(row.byModel)
        : row.totalTokens > 0
          ? [
              {
                model: row.model,
                inputTokens: row.inputTokens,
                outputTokens: row.outputTokens,
                cacheReadTokens: row.cacheReadTokens,
                cacheWriteTokens: row.cacheWriteTokens,
                cost: row.cost,
              },
            ]
          : [];
    for (const model of models) {
      const previous = combined.byModel[model.model];
      combined.byModel[model.model] = previous
        ? {
            ...model,
            inputTokens: previous.inputTokens + model.inputTokens,
            outputTokens: previous.outputTokens + model.outputTokens,
            cacheReadTokens: previous.cacheReadTokens + model.cacheReadTokens,
            cacheWriteTokens:
              previous.cacheWriteTokens + model.cacheWriteTokens,
            cost: previous.cost + model.cost,
          }
        : { ...model };
    }
  }
  if (combined.budgetCap !== undefined) {
    combined.budgetWarning =
      combined.budgetWarning === true ||
      combined.totalCost >= combined.budgetCap * 0.8
        ? true
        : undefined;
  }
  return combined;
}
