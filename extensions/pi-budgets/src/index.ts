import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerModeGate } from "@hollowheap/core";
import {
  addBudgetUsage,
  addDollarUsage,
  clearBudget,
  clearDollarCap,
  clearTokenCap,
  formatBudget,
  formatCompactBudget,
  formatDollarBudget,
  getBudgetUsed,
  getDollarCap,
  getDollarUsed,
  getTokenCap,
  setBudgetBaseline,
  setDollarBaseline,
  setDollarCap,
  setTokenCap,
} from "./budget.js";
import {
  calculateDollarCost,
  formatDollarCost,
  resolveModelPricing,
} from "./pricing.js";

interface EventSink {
  emit(channel: string, data: unknown): void;
}

let eventSink: EventSink | undefined;
let lastOwner: unknown;

function branchUsage(entries: readonly unknown[]): number {
  let total = 0;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const message = (entry as { message?: unknown }).message;
    if (typeof message !== "object" || message === null) continue;
    const typed = message as { role?: unknown; usage?: unknown };
    if (typed.role !== "assistant") continue;
    const usage = typed.usage as
      | { input?: unknown; output?: unknown }
      | undefined;
    if (typeof usage?.input !== "number" || typeof usage.output !== "number") {
      continue;
    }
    total += usage.input + usage.output;
  }
  return total;
}

function sessionBaseline(ctx: ExtensionContext): number {
  const manager = ctx.sessionManager as {
    getBranch?: () => readonly unknown[];
  };
  if (typeof manager.getBranch !== "function") return 0;
  try {
    return branchUsage(manager.getBranch());
  } catch {
    return 0;
  }
}

function publishBudget(owner: unknown): void {
  lastOwner = owner;
  if (eventSink === undefined) return;
  eventSink.emit("statusline:values", {
    name: "budgets",
    text: formatCompactBudget(
      getBudgetUsed(owner),
      getTokenCap(owner),
      getDollarUsed(owner),
      getDollarCap(owner),
    ),
  });
}

function refreshBudget(ctx: ExtensionContext): void {
  publishBudget(ctx.sessionManager);
}

export default function (pi: ExtensionAPI) {
  eventSink = pi.events;
  pi.events.on("statusline:request", () => {
    if (lastOwner !== undefined) publishBudget(lastOwner);
  });
  registerModeGate(
    (mode, owner) =>
      mode === "autopilot" &&
      getTokenCap(owner) === undefined &&
      getDollarCap(owner) === undefined
        ? { veto: "autopilot refused: set a token cap first" }
        : undefined,
    "pi-budgets",
  );
  pi.on("session_start", (_event, ctx) => {
    setBudgetBaseline(ctx.sessionManager, sessionBaseline(ctx));
    setDollarBaseline(ctx.sessionManager, 0);
    clearTokenCap(ctx.sessionManager);
    clearDollarCap(ctx.sessionManager);
    refreshBudget(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    clearBudget(ctx.sessionManager);
    clearTokenCap(ctx.sessionManager);
    clearDollarCap(ctx.sessionManager);
  });
  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const usage = event.message.usage;
    if (
      usage === undefined ||
      typeof usage.input !== "number" ||
      typeof usage.output !== "number"
    ) {
      ctx.ui.notify(
        "pi-budgets: model response reported no usage; budget total unchanged",
        "warning",
      );
      return;
    }
    addBudgetUsage(ctx.sessionManager, usage.input + usage.output);

    const rates = resolveModelPricing(ctx.model);
    if (rates !== undefined) {
      const u = usage as {
        input: number;
        output: number;
        cacheRead?: number;
        cache_read?: number;
        cacheWrite?: number;
        cache_write?: number;
      };
      const dollarCost = calculateDollarCost(
        {
          input: u.input,
          output: u.output,
          cacheRead: u.cacheRead ?? u.cache_read,
          cacheWrite: u.cacheWrite ?? u.cache_write,
        },
        rates,
      );
      addDollarUsage(ctx.sessionManager, dollarCost);
    }

    refreshBudget(ctx);
  });
  pi.on("before_agent_start", (_event, ctx) => {
    const dollarCap = getDollarCap(ctx.sessionManager);
    if (dollarCap !== undefined) {
      const dollarsUsed = getDollarUsed(ctx.sessionManager);
      if (dollarsUsed >= dollarCap) {
        ctx.ui.notify(
          `pi-budgets: dollar budget reached (${formatDollarBudget(dollarsUsed, dollarCap)}); raise it with /budget to continue`,
          "error",
        );
        ctx.abort();
        return;
      }
    }

    const tokenCap = getTokenCap(ctx.sessionManager);
    if (tokenCap !== undefined) {
      const tokensUsed = getBudgetUsed(ctx.sessionManager);
      if (tokensUsed >= tokenCap) {
        ctx.ui.notify(
          `pi-budgets: token budget reached (${formatBudget(tokensUsed, tokenCap)}); raise it with /budget to continue`,
          "error",
        );
        ctx.abort();
        return;
      }
    }
  });
  pi.registerCommand("budget", {
    description: "Show or set the session token or dollar budget cap",
    handler: async (args, ctx) => {
      const raw = args.trim();
      const tokensUsed = getBudgetUsed(ctx.sessionManager);
      const tokenCap = getTokenCap(ctx.sessionManager);
      const dollarsUsed = getDollarUsed(ctx.sessionManager);
      const dollarCap = getDollarCap(ctx.sessionManager);

      if (raw === "") {
        const parts: string[] = [];
        if (dollarCap !== undefined) {
          parts.push(`cost: ${formatDollarBudget(dollarsUsed, dollarCap)}`);
        } else {
          parts.push(`cost: ${formatDollarCost(dollarsUsed)} (no cap set)`);
        }
        if (tokenCap !== undefined) {
          parts.push(`tokens: ${formatBudget(tokensUsed, tokenCap)}`);
        } else {
          parts.push(
            `tokens: ${tokensUsed.toLocaleString("en-US")} (no cap set)`,
          );
        }
        ctx.ui.notify(`pi-budgets: ${parts.join(" | ")}`);
        return;
      }

      if (raw.startsWith("$") || raw.includes(".")) {
        const clean = raw.startsWith("$") ? raw.slice(1).trim() : raw;
        const amount = Number.parseFloat(clean);
        if (Number.isNaN(amount) || amount <= 0) {
          ctx.ui.notify(
            "pi-budgets: dollar budget cap must be a positive number",
            "error",
          );
          return;
        }
        setDollarCap(ctx.sessionManager, amount);
        refreshBudget(ctx);
        ctx.ui.notify(
          `pi-budgets: dollar budget cap $${amount.toFixed(2)} (${formatDollarBudget(dollarsUsed, amount)})`,
        );
        return;
      }

      if (!/^\d+$/.test(raw)) {
        ctx.ui.notify(
          "pi-budgets: budget cap must be a whole number of tokens or a dollar amount (e.g. $5.00)",
          "error",
        );
        return;
      }
      const next = Number(raw);
      if (!Number.isSafeInteger(next) || next <= 0) {
        ctx.ui.notify("pi-budgets: budget cap must be greater than 0", "error");
        return;
      }
      setTokenCap(ctx.sessionManager, next);
      refreshBudget(ctx);
      ctx.ui.notify(
        `pi-budgets: budget cap ${next.toLocaleString("en-US")} tokens (${formatBudget(tokensUsed, next)})`,
      );
    },
  });
}
