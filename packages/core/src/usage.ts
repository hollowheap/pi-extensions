export const USAGE_ENTRY_TYPE = "hollowheap.usage";

export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
}

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

export interface CumulativeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCost: number;
  byModel: Record<string, ModelUsage>;
  budgetCap?: number;
  budgetWarning?: boolean;
  subagents?: SubagentUsage[];
}

export interface UsageSessionManager {
  appendCustomEntry?: (customType: string, data?: unknown) => unknown;
  getEntries?: () => readonly unknown[];
  getBranch?: () => readonly unknown[];
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function roundCost(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

function readByModel(value: unknown): Record<string, ModelUsage> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const byModel: Record<string, ModelUsage> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    if (
      !isNonNegativeNumber(entry.inputTokens) ||
      !isNonNegativeNumber(entry.outputTokens) ||
      !isNonNegativeNumber(entry.cost)
    ) {
      continue;
    }
    byModel[key] = {
      model: typeof entry.model === "string" ? entry.model : key,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheReadTokens: isNonNegativeNumber(entry.cacheReadTokens)
        ? entry.cacheReadTokens
        : 0,
      cacheWriteTokens: isNonNegativeNumber(entry.cacheWriteTokens)
        ? entry.cacheWriteTokens
        : 0,
      cost: entry.cost,
    };
  }
  return byModel;
}

function readSubagents(value: unknown): SubagentUsage[] {
  if (!Array.isArray(value)) return [];
  const rows: SubagentUsage[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      typeof row.agent !== "string" ||
      typeof row.status !== "string"
    ) {
      continue;
    }
    rows.push({
      id: row.id,
      agent: row.agent,
      model: typeof row.model === "string" ? row.model : "unknown",
      status: row.status,
      available: row.available === true,
      inputTokens: isNonNegativeNumber(row.inputTokens) ? row.inputTokens : 0,
      outputTokens: isNonNegativeNumber(row.outputTokens)
        ? row.outputTokens
        : 0,
      cacheReadTokens: isNonNegativeNumber(row.cacheReadTokens)
        ? row.cacheReadTokens
        : 0,
      cacheWriteTokens: isNonNegativeNumber(row.cacheWriteTokens)
        ? row.cacheWriteTokens
        : 0,
      totalTokens: isNonNegativeNumber(row.totalTokens) ? row.totalTokens : 0,
      cost: isNonNegativeNumber(row.cost) ? row.cost : 0,
      byModel: readByModel(row.byModel),
    });
  }
  return rows;
}

export function emptyUsage(): CumulativeUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    byModel: {},
  };
}

export function extractLatestUsage(
  entries: readonly unknown[],
): CumulativeUsage {
  if (!Array.isArray(entries)) return emptyUsage();
  let latest: CumulativeUsage = emptyUsage();

  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const typed = entry as {
      customType?: unknown;
      data?: unknown;
    };
    if (
      typed.customType === USAGE_ENTRY_TYPE &&
      typeof typed.data === "object" &&
      typed.data !== null
    ) {
      const data = typed.data as {
        inputTokens?: unknown;
        outputTokens?: unknown;
        totalCost?: unknown;
        cacheReadTokens?: unknown;
        cacheWriteTokens?: unknown;
        byModel?: unknown;
        budgetCap?: unknown;
        budgetWarning?: unknown;
        subagents?: unknown;
      };
      if (
        isNonNegativeNumber(data.inputTokens) &&
        isNonNegativeNumber(data.outputTokens) &&
        isNonNegativeNumber(data.totalCost)
      ) {
        const cacheReadTokens = isNonNegativeNumber(data.cacheReadTokens)
          ? data.cacheReadTokens
          : 0;
        const cacheWriteTokens = isNonNegativeNumber(data.cacheWriteTokens)
          ? data.cacheWriteTokens
          : 0;
        latest = {
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          totalTokens:
            data.inputTokens +
            data.outputTokens +
            cacheReadTokens +
            cacheWriteTokens,
          totalCost: data.totalCost,
          byModel: readByModel(data.byModel),
          ...(isNonNegativeNumber(data.budgetCap) && data.budgetCap > 0
            ? { budgetCap: data.budgetCap }
            : {}),
          ...(data.budgetWarning === true ? { budgetWarning: true } : {}),
          ...(() => {
            const subagents = readSubagents(data.subagents);
            return subagents.length > 0 ? { subagents } : {};
          })(),
        };
      }
    }
  }

  return latest;
}

export function recordTurnUsage(
  current: CumulativeUsage,
  turnUsage: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  },
  turnCost = 0,
  model = "unknown",
): CumulativeUsage {
  const input = isNonNegativeNumber(turnUsage.input) ? turnUsage.input : 0;
  const output = isNonNegativeNumber(turnUsage.output) ? turnUsage.output : 0;
  const cacheRead = isNonNegativeNumber(turnUsage.cacheRead)
    ? turnUsage.cacheRead
    : 0;
  const cacheWrite = isNonNegativeNumber(turnUsage.cacheWrite)
    ? turnUsage.cacheWrite
    : 0;
  const cost = isNonNegativeNumber(turnCost) ? turnCost : 0;

  if (
    input === 0 &&
    output === 0 &&
    cacheRead === 0 &&
    cacheWrite === 0 &&
    cost === 0
  ) {
    return current;
  }

  const prevModel = current.byModel[model] ?? {
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
  };

  const byModel = {
    ...current.byModel,
    [model]: {
      model,
      inputTokens: prevModel.inputTokens + input,
      outputTokens: prevModel.outputTokens + output,
      cacheReadTokens: prevModel.cacheReadTokens + cacheRead,
      cacheWriteTokens: prevModel.cacheWriteTokens + cacheWrite,
      cost: roundCost(prevModel.cost + cost),
    },
  };

  const newTotal = roundCost(current.totalCost + cost);
  const budgetCap = current.budgetCap;

  return {
    inputTokens: current.inputTokens + input,
    outputTokens: current.outputTokens + output,
    cacheReadTokens: current.cacheReadTokens + cacheRead,
    cacheWriteTokens: current.cacheWriteTokens + cacheWrite,
    totalTokens: current.totalTokens + input + output + cacheRead + cacheWrite,
    totalCost: newTotal,
    byModel,
    ...(budgetCap !== undefined ? { budgetCap } : {}),
    ...(budgetCap !== undefined &&
    (current.budgetWarning === true || newTotal >= budgetCap * 0.8)
      ? { budgetWarning: true }
      : {}),
    ...(current.subagents !== undefined
      ? { subagents: current.subagents }
      : {}),
  };
}

const activeUsage = new WeakMap<object, CumulativeUsage>();

function ownerKey(owner: unknown): object | undefined {
  return typeof owner === "object" && owner !== null ? owner : undefined;
}

export function setSessionUsage(owner: unknown, usage: CumulativeUsage): void {
  const key = ownerKey(owner);
  if (key !== undefined) activeUsage.set(key, usage);
}

export function clearSessionUsage(owner: unknown): void {
  const key = ownerKey(owner);
  if (key !== undefined) activeUsage.delete(key);
}

export function getSessionUsage(owner: unknown): CumulativeUsage {
  const key = ownerKey(owner);
  return (key !== undefined ? activeUsage.get(key) : undefined) ?? emptyUsage();
}

export function setSessionBudgetCap(
  owner: unknown,
  cap: number | undefined,
): CumulativeUsage {
  const current = getSessionUsage(owner);
  const next: CumulativeUsage = { ...current };
  if (cap === undefined) {
    next.budgetCap = undefined;
    next.budgetWarning = undefined;
  } else {
    next.budgetCap = cap;
    next.budgetWarning = next.totalCost >= cap * 0.8 ? true : undefined;
  }
  setSessionUsage(owner, next);
  return next;
}

export function persistUsage(
  manager: UsageSessionManager,
  usage: CumulativeUsage,
): void {
  if (typeof manager.appendCustomEntry !== "function") return;
  try {
    manager.appendCustomEntry(USAGE_ENTRY_TYPE, usage);
  } catch {
    // Custom entries are optional.
  }
}

export function restoreSessionUsage(
  manager: UsageSessionManager,
): CumulativeUsage {
  let entries: readonly unknown[] | undefined;
  if (typeof manager.getEntries === "function") {
    try {
      entries = manager.getEntries();
    } catch {
      entries = undefined;
    }
  } else if (typeof manager.getBranch === "function") {
    try {
      entries = manager.getBranch();
    } catch {
      entries = undefined;
    }
  }

  if (entries === undefined || !Array.isArray(entries)) {
    return getSessionUsage(manager);
  }

  const restored = extractLatestUsage(entries);
  setSessionUsage(manager, restored);
  return restored;
}
