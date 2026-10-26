import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const USAGE_ENTRY_TYPE = "hollowheap.usage";

export interface CumulativeUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCost: number;
}

export function extractLatestUsage(
  entries: readonly unknown[],
): CumulativeUsage {
  let latest: CumulativeUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    totalCost: 0,
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
      };
      if (
        typeof data.inputTokens === "number" &&
        typeof data.outputTokens === "number" &&
        typeof data.totalCost === "number"
      ) {
        latest = {
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          totalTokens:
            typeof data.totalTokens === "number"
              ? data.totalTokens
              : data.inputTokens + data.outputTokens,
          totalCost: data.totalCost,
        };
      }
    }
  }

  return latest;
}

export function recordTurnUsage(
  current: CumulativeUsage,
  turnUsage: { input: number; output: number },
  turnCost = 0,
): CumulativeUsage {
  const input = Math.max(0, turnUsage.input);
  const output = Math.max(0, turnUsage.output);
  const cost = Math.max(0, turnCost);

  return {
    inputTokens: current.inputTokens + input,
    outputTokens: current.outputTokens + output,
    totalTokens: current.totalTokens + input + output,
    totalCost: Math.round((current.totalCost + cost) * 1e6) / 1e6,
  };
}

export function formatUsageReport(usage: CumulativeUsage): string {
  const costStr =
    usage.totalCost < 0.01 && usage.totalCost > 0
      ? `$${usage.totalCost.toFixed(4)}`
      : `$${usage.totalCost.toFixed(2)}`;

  return `Cumulative session usage: ${usage.totalTokens.toLocaleString("en-US")} tokens (${usage.inputTokens.toLocaleString("en-US")} in, ${usage.outputTokens.toLocaleString("en-US")} out) | Cost: ${costStr}`;
}

const activeUsage = new Map<unknown, CumulativeUsage>();

export function getSessionUsage(owner: unknown): CumulativeUsage {
  return (
    activeUsage.get(owner) ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
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
  usage: { input: number; output: number },
): number {
  if (typeof model !== "object" || model === null) return 0;
  const typed = model as { cost?: unknown };
  if (typeof typed.cost !== "object" || typed.cost === null) return 0;
  const cost = typed.cost as { input?: unknown; output?: unknown };
  if (typeof cost.input !== "number" || typeof cost.output !== "number") {
    return 0;
  }
  return (
    (usage.input / 1_000_000) * cost.input +
    (usage.output / 1_000_000) * cost.output
  );
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
    const next = recordTurnUsage(current, usage, turnCost);
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
