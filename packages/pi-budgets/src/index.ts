import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerModeGate } from "@hollowheap/core";
import {
  addBudgetUsage,
  clearBudget,
  clearTokenCap,
  formatBudget,
  getBudgetUsed,
  getTokenCap,
  setBudgetBaseline,
  setTokenCap,
} from "./budget.js";

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
    text: formatBudget(getBudgetUsed(owner), getTokenCap(owner)),
  });
}

function refreshBudget(ctx: ExtensionContext): void {
  const text = formatBudget(
    getBudgetUsed(ctx.sessionManager),
    getTokenCap(ctx.sessionManager),
  );
  ctx.ui.setStatus("budget", text === "" ? undefined : text);
  publishBudget(ctx.sessionManager);
}

export default function (pi: ExtensionAPI) {
  eventSink = pi.events;
  pi.events.on("statusline:request", () => {
    if (lastOwner !== undefined) publishBudget(lastOwner);
  });
  registerModeGate(
    (mode, owner) =>
      mode === "autopilot" && getTokenCap(owner) === undefined
        ? { veto: "autopilot refused: set a token cap first" }
        : undefined,
    "pi-budgets",
  );
  pi.on("session_start", (_event, ctx) => {
    setBudgetBaseline(ctx.sessionManager, sessionBaseline(ctx));
    clearTokenCap(ctx.sessionManager);
    refreshBudget(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    clearBudget(ctx.sessionManager);
    clearTokenCap(ctx.sessionManager);
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
    refreshBudget(ctx);
  });
  pi.on("before_agent_start", (_event, ctx) => {
    const cap = getTokenCap(ctx.sessionManager);
    if (cap === undefined) return;
    const used = getBudgetUsed(ctx.sessionManager);
    if (used < cap) return;
    ctx.ui.notify(
      `pi-budgets: token budget reached (${formatBudget(used, cap)}); raise it with /budget to continue`,
      "error",
    );
    ctx.abort();
  });
  pi.registerCommand("budget", {
    description: "Show or set the session token budget in whole tokens",
    handler: async (args, ctx) => {
      const raw = args.trim();
      const used = getBudgetUsed(ctx.sessionManager);
      const cap = getTokenCap(ctx.sessionManager);
      if (raw === "") {
        const text = formatBudget(used, cap) || "0 used";
        ctx.ui.notify(
          `pi-budgets: budget ${text}${cap === undefined ? " (no cap set)" : ""}`,
        );
        return;
      }
      if (!/^\d+$/.test(raw)) {
        ctx.ui.notify(
          "pi-budgets: budget cap must be a whole number of tokens",
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
        `pi-budgets: budget cap ${next.toLocaleString("en-US")} tokens (${formatBudget(used, next)})`,
      );
    },
  });
}
