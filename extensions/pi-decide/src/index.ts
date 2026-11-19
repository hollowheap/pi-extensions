import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { readBranchEntries } from "@hollowheap/core/state";
import { notify } from "@hollowheap/pi-ui/host";
import {
  createDecideTool,
  persistDecideStats,
  restoreDecideStats,
} from "./decide.js";
import { loadDecideConfig } from "./settings.js";

function restoreStats(ctx: ExtensionContext): void {
  const sessionManager = ctx.sessionManager;
  if (typeof sessionManager !== "object" || sessionManager === null) return;
  const entries = readBranchEntries(sessionManager);
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
      notify(ctx, `pi-decide: ${sanitizeTerminalText(message)}`, "warning");
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
