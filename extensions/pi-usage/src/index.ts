import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { formatDollarCost, messageCost } from "@hollowheap/core/pricing";
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
import {
  combineUsage,
  mergeSubagentUsage,
  scanSubagentUsage,
} from "./subagents.js";

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

const BAR_WIDTH = 16;
const MODEL_NAME_WIDTH = 20;
const SUBAGENT_LABEL_WIDTH = 30;
const SUBAGENT_MODEL_WIDTH = 14;
const SUBAGENT_BAR_WIDTH = 12;

function usageBar(value: number, total: number, width = BAR_WIDTH): string {
  if (total <= 0 || value <= 0) return "░".repeat(width);
  const ratio = Math.min(1, value / total);
  const filled = Math.max(1, Math.round(ratio * width));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function share(part: number, total: number): string {
  if (total <= 0) return "0.0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function compactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
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
    "",
    "Token breakdown",
  ];

  const composition: Array<[string, number]> = [
    ["in", usage.inputTokens],
    ["out", usage.outputTokens],
    ["read", usage.cacheReadTokens],
    ["write", usage.cacheWriteTokens],
  ];
  for (const [label, value] of composition) {
    lines.push(
      `  ${label.padEnd(5)} ${usageBar(value, usage.totalTokens)} ${share(value, usage.totalTokens).padStart(6)} ${value.toLocaleString("en-US").padStart(10)}`,
    );
  }

  const models = Object.values(usage.byModel);
  if (models.length > 0) {
    lines.push("", "Per-model breakdown");
    lines.push(
      `  ${"model".padEnd(MODEL_NAME_WIDTH)} ${"tokens".padStart(8)} ${"share".padStart(6)} ${"bar".padEnd(BAR_WIDTH)} ${"cost".padStart(7)}`,
    );
    for (const m of models) {
      const tokens =
        m.inputTokens + m.outputTokens + m.cacheReadTokens + m.cacheWriteTokens;
      const mCost =
        m.cost < 0.01 && m.cost > 0
          ? `$${m.cost.toFixed(4)}`
          : `$${m.cost.toFixed(2)}`;
      lines.push(
        `  ${sanitizeTerminalText(m.model).slice(0, MODEL_NAME_WIDTH).padEnd(MODEL_NAME_WIDTH)} ${compactTokens(tokens).padStart(8)} ${share(tokens, usage.totalTokens).padStart(6)} ${usageBar(tokens, usage.totalTokens)} ${mCost.padStart(7)}`,
      );
    }
  }

  if (subagents.length > 0) {
    lines.push("", "Subagents");
    lines.push(
      `  ${"agent/id".padEnd(SUBAGENT_LABEL_WIDTH)} ${"model".padEnd(SUBAGENT_MODEL_WIDTH)} ${"tokens".padStart(8)} ${"bar".padEnd(SUBAGENT_BAR_WIDTH)} ${"cost".padStart(7)}`,
    );
    for (const subagent of subagents) {
      if (!subagent.available) {
        lines.push(
          `  @${sanitizeTerminalText(subagent.id)} (${sanitizeTerminalText(subagent.agent)}) [${subagent.status}]: usage unavailable`,
        );
        continue;
      }
      const label = `@${sanitizeTerminalText(subagent.id)} (${sanitizeTerminalText(subagent.agent)}) [${subagent.status}]`;
      const labelText =
        label.length > SUBAGENT_LABEL_WIDTH
          ? `${label.slice(0, SUBAGENT_LABEL_WIDTH - 1)}…`
          : label.padEnd(SUBAGENT_LABEL_WIDTH);
      const modelText =
        sanitizeTerminalText(subagent.model).length > SUBAGENT_MODEL_WIDTH
          ? `${sanitizeTerminalText(subagent.model).slice(0, SUBAGENT_MODEL_WIDTH - 1)}…`
          : sanitizeTerminalText(subagent.model).padEnd(SUBAGENT_MODEL_WIDTH);
      lines.push(
        `  ${labelText} ${modelText} ${compactTokens(subagent.totalTokens).padStart(8)} ${usageBar(subagent.totalTokens, usage.totalTokens, SUBAGENT_BAR_WIDTH)} ${formatDollarCost(subagent.cost).padStart(7)}`,
      );
    }
  }

  if (usage.budgetCap !== undefined) {
    lines.push(
      "",
      `Budget ${usageBar(usage.totalCost, usage.budgetCap)} ${formatDollarCost(usage.totalCost)} / ${formatDollarCost(usage.budgetCap)}`,
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
  const persistedSubagentSignatures = new WeakMap<object, string>();
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
    subagentRows = mergeSubagentUsage(scanned, current.subagents ?? []);
    if (subagentRows.length === 0) return subagentRows;
    const next = { ...current, subagents: subagentRows };
    setSessionUsage(owner, next);
    if (typeof owner === "object" && owner !== null) {
      const signature = JSON.stringify(subagentRows);
      if (persistedSubagentSignatures.get(owner) !== signature) {
        persistedSubagentSignatures.set(owner, signature);
        persistUsage(owner as never, next);
      }
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
    if (
      subagentRows.length > 0 &&
      typeof ctx.sessionManager === "object" &&
      ctx.sessionManager !== null
    ) {
      persistedSubagentSignatures.set(
        ctx.sessionManager,
        JSON.stringify(subagentRows),
      );
    }
    warningNotified = false;
    refreshSubagents(ctx.sessionManager);
    publishStatus(combined(ctx.sessionManager));
  });

  pi.on("session_tree", (_event, ctx) => {
    statusOwner = ctx.sessionManager;
    activeSubagents.clear();
    const restored = restoreSessionUsage(ctx.sessionManager);
    subagentRows = restored.subagents ?? [];
    if (
      subagentRows.length > 0 &&
      typeof ctx.sessionManager === "object" &&
      ctx.sessionManager !== null
    ) {
      persistedSubagentSignatures.set(
        ctx.sessionManager,
        JSON.stringify(subagentRows),
      );
    }
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

  pi.on("session_compact", (_event, ctx) => {
    const owner = ctx?.sessionManager ?? statusOwner;
    if (!owner) return;
    const current = getSessionUsage(owner);
    if (
      current.totalTokens > 0 ||
      current.totalCost > 0 ||
      current.budgetCap !== undefined
    ) {
      persistUsage(owner as never, current);
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
    const turnCost = messageCost(event.message, pricingModel);
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
      !warningNotified &&
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
      const sub = subcommand?.toLowerCase();
      if (sub === "cap" || sub === "budget") {
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
          setSessionBudgetCap(ctx.sessionManager, undefined, {
            persist: true,
          });
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
              `pi-usage: cap must be a positive dollar amount, e.g. /usage ${sub} $5`,
              "error",
            );
          return;
        }
        warningNotified = false;
        const next = setSessionBudgetCap(ctx.sessionManager, amount, {
          persist: true,
        });
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
