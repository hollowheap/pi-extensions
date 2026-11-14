import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadDecideConfig } from "./config.js";
import {
  createDecideTool,
  persistDecideStats,
  restoreDecideStats,
} from "./decide.js";

function restoreStats(ctx: ExtensionContext): void {
  const sessionManager = ctx.sessionManager as
    | { getBranch?: () => unknown[]; getEntries?: () => unknown[] }
    | undefined;
  if (typeof sessionManager !== "object" || sessionManager === null) return;
  const entries =
    typeof sessionManager.getBranch === "function"
      ? sessionManager.getBranch()
      : typeof sessionManager.getEntries === "function"
        ? sessionManager.getEntries()
        : undefined;
  if (!entries) return;
  restoreDecideStats(sessionManager, entries);
}

export default function (pi: ExtensionAPI): void {
  const diagnostics: string[] = [];
  loadDecideConfig(getAgentDir(), (message) => diagnostics.push(message));
  pi.registerTool(createDecideTool(pi));

  let reported = false;
  pi.on("session_start", (_event, ctx) => {
    restoreStats(ctx);
    if (reported || diagnostics.length === 0) return;
    reported = true;
    for (const message of diagnostics) {
      ctx.ui?.notify?.(`pi-decide: ${message}`, "warning");
    }
  });
  pi.on("session_tree", (_event, ctx) => {
    restoreStats(ctx);
  });
  pi.on("agent_end", (_event, ctx) => {
    if (
      typeof ctx?.sessionManager === "object" &&
      ctx.sessionManager !== null
    ) {
      persistDecideStats(ctx.sessionManager, pi);
    }
  });
  pi.on("session_compact", (_event, ctx) => {
    if (
      typeof ctx?.sessionManager === "object" &&
      ctx.sessionManager !== null
    ) {
      persistDecideStats(ctx.sessionManager, pi, true);
    }
  });
}
