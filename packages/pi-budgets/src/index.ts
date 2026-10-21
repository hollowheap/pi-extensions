import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ModeEnterQuery } from "@hollowheap/core";
import {
  addBudgetUsage,
  clearBudget,
  clearTokenCap,
  formatBudget,
  getBudgetUsed,
  getTokenCap,
  setTokenCap,
} from "./budget.js";

export const GUARD_MODE_ENTER_CHANNEL = "guard:mode-enter";

interface EventSink {
  emit(channel: string, data: unknown): void;
}

let eventSink: EventSink | undefined;
let lastOwner: unknown;

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
  pi.events.on(GUARD_MODE_ENTER_CHANNEL, (data) => {
    const query = data as ModeEnterQuery;
    if (query.mode === "autopilot" && getTokenCap(query.owner) === undefined) {
      query.veto = "autopilot refused: set a token cap first";
    }
  });
  pi.on("session_start", (_event, ctx) => {
    clearBudget(ctx.sessionManager);
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
