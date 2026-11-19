import {
  type ExtensionAPI,
  compact as compactSession,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { registerMemoryCommands } from "./commands.js";
import { MEMORY_WORKSPACE_TYPE } from "./ledger.js";
import { observeConversation } from "./observer.js";
import { loadMemoryConfig } from "./settings.js";
import {
  createMemoryState,
  handleBeforeCompact,
  maybeObserve,
  resetMemory,
  restoreMemory,
} from "./state.js";
import { registerMemoryTools } from "./tools.js";
import { resolveWorkspaceRoot } from "./workspace.js";

export { resolveWorkspaceRoot } from "./workspace.js";

export interface MemoryExtensionDeps {
  getAgentDir?: () => string;
  observe?: typeof observeConversation;
  compact?: typeof compactSession;
}

export function createMemoryExtension(
  deps: MemoryExtensionDeps = {},
): (pi: ExtensionAPI) => void {
  const resolveAgentDir = deps.getAgentDir ?? getAgentDir;
  const observe = deps.observe ?? observeConversation;
  const compact = deps.compact ?? compactSession;

  return (pi: ExtensionAPI): void => {
    if (process.env.PI_ACP) return;

    const state = createMemoryState({
      pi,
      getAgentDir: resolveAgentDir,
      observe,
      compact,
    });

    pi.on("session_start", (_event, ctx) => {
      restoreMemory(state, ctx);
    });

    pi.on("session_tree", (_event, ctx) => {
      restoreMemory(state, ctx);
    });

    pi.on("session_shutdown", () => {
      resetMemory(state);
      state.statusline.publish("");
    });

    pi.on("agent_settled", (event, ctx) => {
      if (event.aborted) return;
      void maybeObserve(state, ctx).catch(() => {});
    });

    pi.on("session_before_compact", (event, ctx) =>
      handleBeforeCompact(state, event, ctx),
    );

    registerMemoryTools(state);
    registerMemoryCommands(state);
  };
}

function memoryExtension(pi: ExtensionAPI): void {
  createMemoryExtension()(pi);
  if (process.env.PI_ACP) return;
  pi.on("session_start", (_event, ctx) => {
    const config = loadMemoryConfig(getAgentDir());
    pi.appendEntry(MEMORY_WORKSPACE_TYPE, {
      workspace: resolveWorkspaceRoot(ctx.cwd ?? process.cwd()),
      origin: "workspace",
      sessionOrigin: ctx.sessionManager?.getSessionId?.() ?? "",
      redacted: config.redactSecrets,
      createdAt: Date.now(),
    });
  });
}

const defaultExtension = Object.assign(memoryExtension, {
  resolveWorkspaceRoot,
});

export default defaultExtension;
