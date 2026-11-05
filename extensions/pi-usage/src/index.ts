import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  calculateDollarCost,
  formatDollarCost,
  resolveModelPricing,
} from "@hollowheap/core/pricing";
import {
  type CumulativeUsage,
  type SubagentUsage,
  clearSessionUsage,
  getSessionUsage,
  persistUsage,
  recordTurnUsage,
  restoreSessionUsage,
  setSessionBudgetCap,
  setSessionUsage,
} from "@hollowheap/core/usage";
import { combineUsage, scanSubagentUsage } from "./subagents.js";

export {
  type CumulativeUsage,
  type ModelUsage,
  type SubagentUsage,
  USAGE_ENTRY_TYPE,
  clearSessionUsage,
  emptyUsage,
  extractLatestUsage,
  getSessionUsage,
  persistUsage,
  recordTurnUsage,
  restoreSessionUsage,
  setSessionBudgetCap,
  setSessionUsage,
} from "@hollowheap/core/usage";

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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

  pi.events?.on?.("usage:refresh", () => {
    if (statusOwner === undefined || statusOwner === null) return;
    restoreSessionUsage(statusOwner as never);
    refreshSubagents(statusOwner);
    publishStatus(combined(statusOwner));
  });

  pi.on("session_start", (_event, ctx) => {
    statusOwner = ctx.sessionManager;
    activeSubagents.clear();
    const restored = restoreSessionUsage(ctx.sessionManager);
    subagentRows = restored.subagents ?? [];
    warningNotified = false;
    refreshSubagents(ctx.sessionManager);
    publishStatus(combined(ctx.sessionManager));
  });

  pi.on("session_tree", (_event, ctx) => {
    statusOwner = ctx.sessionManager;
    activeSubagents.clear();
    const restored = restoreSessionUsage(ctx.sessionManager);
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
    persistUsage(ctx.sessionManager, next);
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
          persistUsage(ctx.sessionManager, next);
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
        persistUsage(ctx.sessionManager, next);
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
