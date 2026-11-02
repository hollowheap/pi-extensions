import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  calculateDollarCost,
  formatDollarCost,
  resolveModelPricing,
} from "@hollowheap/core";
import {
  type SubagentUsage,
  combineUsage,
  readSubagentUsageSnapshot,
  scanSubagentUsage,
} from "./subagents.js";

export const USAGE_ENTRY_TYPE = "hollowheap.usage";

export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
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

function emptyUsage(): CumulativeUsage {
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

export function extractLatestUsage(
  entries: readonly unknown[],
): CumulativeUsage {
  if (!Array.isArray(entries)) return emptyUsage();
  let latest: CumulativeUsage = emptyUsage();

  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const typed = entry as {
      type?: unknown;
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
            const subagents = readSubagentUsageSnapshot(data.subagents);
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

export function formatUsageReport(
  usage: CumulativeUsage,
  subagents: readonly SubagentUsage[] = usage.subagents ?? [],
): string {
  const costStr =
    usage.totalCost < 0.01 && usage.totalCost > 0
      ? `$${usage.totalCost.toFixed(4)}`
      : `$${usage.totalCost.toFixed(2)}`;

  const lines = [
    `Cumulative session usage: ${usage.totalTokens.toLocaleString("en-US")} tokens (${usage.inputTokens.toLocaleString("en-US")} in, ${usage.outputTokens.toLocaleString("en-US")} out, ${usage.cacheReadTokens.toLocaleString("en-US")} cache-read, ${usage.cacheWriteTokens.toLocaleString("en-US")} cache-write) | Cost: ${costStr}`,
  ];

  const models = Object.values(usage.byModel);
  if (models.length > 0) {
    lines.push("Per-model breakdown:");
    for (const m of models) {
      const mCost =
        m.cost < 0.01 && m.cost > 0
          ? `$${m.cost.toFixed(4)}`
          : `$${m.cost.toFixed(2)}`;
      lines.push(
        `  ${m.model}: ${m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheWriteTokens} tokens | ${mCost}`,
      );
    }
  }

  if (subagents.length > 0) {
    lines.push("Subagents:");
    for (const subagent of subagents) {
      if (!subagent.available) {
        lines.push(
          `  @${subagent.id} (${subagent.agent}) [${subagent.status}]: usage unavailable`,
        );
        continue;
      }
      lines.push(
        `  @${subagent.id} (${subagent.agent}) [${subagent.status}] ${subagent.model}: ${subagent.totalTokens.toLocaleString("en-US")} tokens | ${formatDollarCost(subagent.cost)}`,
      );
    }
  }

  if (usage.budgetCap !== undefined) {
    lines.push(
      `Budget: $${usage.totalCost.toFixed(2)} / $${usage.budgetCap.toFixed(2)}`,
    );
  }
  if (usage.budgetWarning && usage.budgetCap !== undefined) {
    lines.push(
      `⚠ Budget warning: ${usage.totalCost.toFixed(2)} / ${usage.budgetCap.toFixed(2)}`,
    );
  }

  return lines.join("\n");
}

const activeUsage = new WeakMap<object, CumulativeUsage>();

function ownerKey(owner: unknown): object | undefined {
  return typeof owner === "object" && owner !== null ? owner : undefined;
}

function setSessionUsage(owner: unknown, usage: CumulativeUsage): void {
  const key = ownerKey(owner);
  if (key !== undefined) activeUsage.set(key, usage);
}

function clearSessionUsage(owner: unknown): void {
  const key = ownerKey(owner);
  if (key !== undefined) activeUsage.delete(key);
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

export function getSessionUsage(owner: unknown): CumulativeUsage {
  const key = ownerKey(owner);
  return (key !== undefined ? activeUsage.get(key) : undefined) ?? emptyUsage();
}

function persistUsage(ctx: ExtensionContext, usage: CumulativeUsage): void {
  const manager = ctx.sessionManager as {
    appendCustomEntry?: (customType: string, data?: unknown) => unknown;
  };
  if (typeof manager.appendCustomEntry !== "function") return;
  try {
    manager.appendCustomEntry(USAGE_ENTRY_TYPE, usage);
  } catch {
    // Custom entries are optional.
  }
}

function restoreSessionUsage(ctx: ExtensionContext): CumulativeUsage {
  const manager = ctx.sessionManager as {
    getEntries?: () => readonly unknown[];
    getBranch?: () => readonly unknown[];
  };
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
    return getSessionUsage(ctx.sessionManager);
  }

  const restored = extractLatestUsage(entries);
  setSessionUsage(ctx.sessionManager, restored);
  return restored;
}

export default function (pi: ExtensionAPI) {
  let statusOwner: unknown;
  let subagentRows: SubagentUsage[] = [];
  let warningNotified = false;
  const activeSubagents = new Set<string>();
  const sessionIdOf = (owner: unknown): string | undefined => {
    if (typeof owner !== "object" || owner === null) return undefined;
    const manager = owner as { getSessionId?: () => string };
    return typeof manager.getSessionId === "function"
      ? manager.getSessionId()
      : undefined;
  };
  const refreshSubagents = (owner: unknown = statusOwner): SubagentUsage[] => {
    const parentSession = sessionIdOf(owner);
    if (parentSession === undefined) return subagentRows;
    const current = getSessionUsage(owner);
    const scanned = scanSubagentUsage(getAgentDir(), parentSession);
    subagentRows = scanned.length > 0 ? scanned : (current.subagents ?? []);
    if (subagentRows.length > 0) {
      setSessionUsage(owner, { ...current, subagents: subagentRows });
    }
    return subagentRows;
  };
  const combined = (owner: unknown): CumulativeUsage =>
    combineUsage(getSessionUsage(owner), subagentRows);
  const statusText = (usage: CumulativeUsage): string =>
    usage.budgetCap === undefined
      ? ""
      : `${formatDollarCost(usage.totalCost)}/${formatDollarCost(usage.budgetCap)}`;
  const publishStatus = (usage: CumulativeUsage): void => {
    pi.events?.emit?.("statusline:values", {
      name: "usage",
      text: statusText(usage),
    });
  };
  const publishCurrent = (): void => {
    if (statusOwner !== undefined) {
      publishStatus(combined(statusOwner));
    }
  };

  pi.events?.on?.("statusline:request", (data: unknown) => {
    if (typeof data !== "object" || data === null) return;
    const names = (data as { names?: unknown }).names;
    if (!Array.isArray(names) || !names.includes("usage")) return;
    publishCurrent();
  });

  pi.events?.on?.("subagents:state", (data: unknown) => {
    if (!Array.isArray(data)) return;
    const next = new Set<string>();
    for (const item of data) {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof (item as { id?: unknown }).id === "string"
      ) {
        next.add((item as { id: string }).id);
      }
    }
    const removed = [...activeSubagents].some((id) => !next.has(id));
    activeSubagents.clear();
    for (const id of next) activeSubagents.add(id);
    if (!removed) return;
    refreshSubagents();
    publishCurrent();
  });

  pi.on("session_start", (_event, ctx) => {
    statusOwner = ctx.sessionManager;
    activeSubagents.clear();
    const restored = restoreSessionUsage(ctx);
    subagentRows = restored.subagents ?? [];
    warningNotified = false;
    refreshSubagents(ctx.sessionManager);
    publishStatus(combined(ctx.sessionManager));
  });

  pi.on("session_tree", (_event, ctx) => {
    statusOwner = ctx.sessionManager;
    activeSubagents.clear();
    const restored = restoreSessionUsage(ctx);
    subagentRows = restored.subagents ?? [];
    warningNotified = false;
    refreshSubagents(ctx.sessionManager);
    publishStatus(combined(ctx.sessionManager));
  });

  pi.on("session_shutdown", (_event, ctx) => {
    clearSessionUsage(ctx.sessionManager);
    activeSubagents.clear();
    subagentRows = [];
    warningNotified = false;
    if (statusOwner === ctx.sessionManager) {
      statusOwner = undefined;
      pi.events?.emit?.("statusline:values", { name: "usage", text: "" });
    }
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const usage = event.message.usage;
    if (
      usage === undefined ||
      !isNonNegativeNumber(usage.input) ||
      !isNonNegativeNumber(usage.output)
    ) {
      return;
    }

    const current = getSessionUsage(ctx.sessionManager);
    const modelId =
      typeof event.message.model === "string" ? event.message.model : "unknown";
    const contextModel = ctx.model as { id?: unknown } | undefined;
    const pricingModel =
      modelId === "unknown" || contextModel?.id === modelId
        ? contextModel
        : modelId;
    const pricing = resolveModelPricing(pricingModel);
    const turnCost = pricing
      ? calculateDollarCost(
          {
            input: usage.input,
            output: usage.output,
            cacheRead: usage.cacheRead,
            cacheWrite: usage.cacheWrite,
          },
          pricing,
        )
      : 0;
    const next = recordTurnUsage(
      current,
      {
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
      },
      turnCost,
      modelId,
    );
    setSessionUsage(ctx.sessionManager, next);
    persistUsage(ctx, next);
    publishCurrent();

    const after = combined(ctx.sessionManager);
    if (
      after.budgetWarning === true &&
      current.budgetWarning !== true &&
      after.budgetCap !== undefined
    ) {
      ctx.ui.notify(
        `pi-usage: budget warning (${after.totalCost.toFixed(2)} / ${after.budgetCap.toFixed(2)})`,
        "warning",
      );
      warningNotified = true;
    }
  });

  pi.on("before_agent_start", (_event, ctx) => {
    refreshSubagents(ctx.sessionManager);
    const usage = combined(ctx.sessionManager);
    if (usage.budgetCap !== undefined && usage.totalCost >= usage.budgetCap) {
      ctx.ui.notify(
        `pi-usage: budget cap reached (${usage.totalCost.toFixed(2)} / ${usage.budgetCap.toFixed(2)}); raise it with /usage cap`,
        "error",
      );
      warningNotified = true;
      ctx.abort();
      return;
    }
    if (
      usage.budgetCap !== undefined &&
      usage.budgetWarning === true &&
      !warningNotified
    ) {
      ctx.ui.notify(
        `pi-usage: budget warning (${usage.totalCost.toFixed(2)} / ${usage.budgetCap.toFixed(2)})`,
        "warning",
      );
      warningNotified = true;
    }
  });

  pi.registerCommand("usage", {
    description: "Show cumulative token and dollar usage across compaction",
    handler: async (args, ctx) => {
      const raw = args.trim();
      const [subcommand, ...rest] = raw.split(/\s+/).filter(Boolean);
      if (subcommand?.toLowerCase() === "cap") {
        const value = rest.join(" ").trim();
        if (value === "") {
          const usage = getSessionUsage(ctx.sessionManager);
          const text =
            usage.budgetCap === undefined
              ? "pi-usage: no budget cap set"
              : `pi-usage: budget cap $${usage.budgetCap.toFixed(2)} (used $${usage.totalCost.toFixed(2)})`;
          if (ctx.hasUI) ctx.ui.notify(text);
          else console.log(text);
          return;
        }
        if (value.toLowerCase() === "off" || value.toLowerCase() === "none") {
          warningNotified = false;
          const next = setSessionBudgetCap(ctx.sessionManager, undefined);
          persistUsage(ctx, next);
          publishCurrent();
          if (ctx.hasUI) ctx.ui.notify("pi-usage: budget cap cleared");
          return;
        }
        const amountText = value.startsWith("$")
          ? value.slice(1).trim()
          : value;
        const amount = Number.parseFloat(amountText);
        if (!Number.isFinite(amount) || amount <= 0) {
          if (ctx.hasUI)
            ctx.ui.notify(
              "pi-usage: cap must be a positive dollar amount, e.g. /usage cap $5",
              "error",
            );
          return;
        }
        warningNotified = false;
        const next = setSessionBudgetCap(ctx.sessionManager, amount);
        persistUsage(ctx, next);
        publishCurrent();
        if (ctx.hasUI) {
          ctx.ui.notify(
            `pi-usage: budget cap $${amount.toFixed(2)}${next.budgetWarning ? " (warning threshold reached)" : ""}`,
            next.budgetWarning ? "warning" : "info",
          );
        }
        return;
      }

      const subagents = refreshSubagents(ctx.sessionManager);
      const usage = combined(ctx.sessionManager);
      const report = formatUsageReport(usage, subagents);
      if (ctx.hasUI) {
        ctx.ui.notify(report);
      } else {
        console.log(report);
      }
    },
  });
}
