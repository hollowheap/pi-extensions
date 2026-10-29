import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { calculateDollarCost, resolveModelPricing } from "@hollowheap/core";

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
}

export function extractLatestUsage(
  entries: readonly unknown[],
): CumulativeUsage {
  let latest: CumulativeUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    byModel: {},
  };

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
        totalTokens?: unknown;
        totalCost?: unknown;
        cacheReadTokens?: unknown;
        cacheWriteTokens?: unknown;
        byModel?: unknown;
        budgetCap?: unknown;
      };
      if (
        typeof data.inputTokens === "number" &&
        typeof data.outputTokens === "number" &&
        typeof data.totalCost === "number"
      ) {
        latest = {
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          cacheReadTokens:
            typeof data.cacheReadTokens === "number" ? data.cacheReadTokens : 0,
          cacheWriteTokens:
            typeof data.cacheWriteTokens === "number"
              ? data.cacheWriteTokens
              : 0,
          totalTokens:
            typeof data.totalTokens === "number"
              ? data.totalTokens
              : data.inputTokens + data.outputTokens,
          totalCost: data.totalCost,
          byModel:
            typeof data.byModel === "object" && data.byModel !== null
              ? (data.byModel as Record<string, ModelUsage>)
              : {},
          ...(typeof data.budgetCap === "number"
            ? { budgetCap: data.budgetCap }
            : {}),
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
  const input = Math.max(0, turnUsage.input);
  const output = Math.max(0, turnUsage.output);
  const cacheRead = Math.max(0, turnUsage.cacheRead ?? 0);
  const cacheWrite = Math.max(0, turnUsage.cacheWrite ?? 0);
  const cost = Math.max(0, turnCost);

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
      cost: Math.round((prevModel.cost + cost) * 1e6) / 1e6,
    },
  };

  const newTotal = Math.round((current.totalCost + cost) * 1e6) / 1e6;
  const budgetCap = current.budgetCap;

  return {
    inputTokens: current.inputTokens + input,
    outputTokens: current.outputTokens + output,
    cacheReadTokens: current.cacheReadTokens + cacheRead,
    cacheWriteTokens: current.cacheWriteTokens + cacheWrite,
    totalTokens: current.totalTokens + input + output,
    totalCost: newTotal,
    byModel,
    ...(budgetCap !== undefined ? { budgetCap } : {}),
    ...(budgetCap !== undefined && newTotal >= budgetCap * 0.8
      ? { budgetWarning: true }
      : {}),
  };
}

export function formatUsageReport(usage: CumulativeUsage): string {
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
        `  ${m.model}: ${m.inputTokens + m.outputTokens} tokens | ${mCost}`,
      );
    }
  }

  if (usage.budgetWarning) {
    lines.push(
      `⚠ Budget warning: ${usage.totalCost.toFixed(2)} / ${usage.budgetCap?.toFixed(2) ?? "?"}`,
    );
  }

  return lines.join("\n");
}

const activeUsage = new Map<unknown, CumulativeUsage>();

export function getSessionUsage(owner: unknown): CumulativeUsage {
  return (
    activeUsage.get(owner) ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      byModel: {},
    }
  );
}

function restoreSessionUsage(ctx: ExtensionContext): CumulativeUsage {
  const manager = ctx.sessionManager as {
    getEntries?: () => readonly unknown[];
    getBranch?: () => readonly unknown[];
  };
  let entries: readonly unknown[] = [];
  if (typeof manager.getEntries === "function") {
    try {
      entries = manager.getEntries();
    } catch {
      entries = [];
    }
  } else if (typeof manager.getBranch === "function") {
    try {
      entries = manager.getBranch();
    } catch {
      entries = [];
    }
  }

  const restored = extractLatestUsage(entries);
  activeUsage.set(ctx.sessionManager, restored);
  return restored;
}

function calculateCostFromModel(
  model: unknown,
  usage: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  },
): number {
  const pricing = resolveModelPricing(model);
  if (!pricing) return 0;
  return calculateDollarCost(usage, pricing);
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    restoreSessionUsage(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    restoreSessionUsage(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    activeUsage.delete(ctx.sessionManager);
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const usage = event.message.usage;
    if (
      usage === undefined ||
      typeof usage.input !== "number" ||
      typeof usage.output !== "number"
    ) {
      return;
    }

    const current = getSessionUsage(ctx.sessionManager);
    const turnCost = calculateCostFromModel(ctx.model, usage);
    const modelId =
      typeof event.message.model === "string" ? event.message.model : "unknown";
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
    activeUsage.set(ctx.sessionManager, next);

    const manager = ctx.sessionManager as {
      appendCustomEntry?: (customType: string, data?: unknown) => unknown;
    };
    if (typeof manager.appendCustomEntry === "function") {
      try {
        manager.appendCustomEntry(USAGE_ENTRY_TYPE, next);
      } catch {
        // Safe handling if custom entries are not supported
      }
    }
  });

  pi.registerCommand("usage", {
    description: "Show cumulative token and dollar usage across compaction",
    handler: async (_args, ctx) => {
      const usage = getSessionUsage(ctx.sessionManager);
      const report = formatUsageReport(usage);
      if (ctx.hasUI) {
        ctx.ui.notify(report);
      } else {
        console.log(report);
      }
    },
  });
}
