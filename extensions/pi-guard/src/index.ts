import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensureDefaultDecideConfig } from "@hollowheap/policy";
import { createCommands } from "./commands.js";
import { createToolHandlers } from "./decisions.js";
import { registerBuiltins, registerModeCommands } from "./mode.js";
import {
  createGuardState,
  createRepublisher,
  createSessionHandlers,
} from "./state.js";

export { AUDIT_TYPE, formatModeBadge } from "./state.js";

export default function (pi: ExtensionAPI): void {
  ensureDefaultDecideConfig();
  registerBuiltins();
  const state = createGuardState(pi.events);
  const tools = createToolHandlers(pi, state);
  const session = createSessionHandlers(pi, state);
  const commands = createCommands(state);
  const republish = createRepublisher(state);

  pi.events.on("tui:config-changed", republish);
  pi.events.on("mode:changed", republish);

  pi.on("tool_call", tools.toolCall);
  pi.on("tool_result", tools.toolResult);
  pi.on("session_start", session.restore);
  pi.on("session_tree", session.tree);
  pi.on("session_compact", session.compact);
  pi.on("session_shutdown", session.shutdown);

  pi.registerCommand("grant", commands.grant);
  pi.registerCommand("context", commands.context);
  pi.registerCommand("guard", commands.guard);
  registerModeCommands(pi);
}
