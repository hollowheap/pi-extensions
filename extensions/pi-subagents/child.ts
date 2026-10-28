import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { enterMode } from "@hollowheap/core";
import { loadSubagentsConfig } from "./src/config.js";
import { SubagentStore } from "./src/state.js";
import { acquireWriteLock } from "./src/write-lock.js";

const WRITE_TOOLS = new Set(["write", "edit", "bash"]);
const HOLD_TIMEOUT_MS = 10 * 60 * 1000;

export interface ChildLockOptions {
  agentDir?: () => string;
  holdTimeoutMs?: number;
}

export function createChildLockExtension(
  options: ChildLockOptions = {},
): (pi: ExtensionAPI) => void {
  const resolveAgentDir = options.agentDir ?? getAgentDir;
  const holdTimeoutMs = options.holdTimeoutMs ?? HOLD_TIMEOUT_MS;
  return (pi) => {
    const releases = new Map<string, () => void>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const release = (id: string): void => {
      const timer = timers.get(id);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(id);
      const releaseLock = releases.get(id);
      releases.delete(id);
      releaseLock?.();
    };

    pi.on("session_start", (_event, ctx) => {
      const mode = process.env.PI_SUBAGENT_MODE;
      if (mode && ctx.sessionManager) {
        enterMode(ctx.sessionManager, mode);
      }
    });

    pi.on("tool_call", async (event) => {
      const subagentId = process.env.PI_SUBAGENT_ID;
      if (subagentId) {
        try {
          const store = new SubagentStore(resolveAgentDir());
          store.update(subagentId, {
            activeTool: event.toolName,
            activeToolStartedAt: Date.now(),
          });
        } catch {
          // Best-effort
        }
      }

      if (!WRITE_TOOLS.has(event.toolName)) return;
      const agentDir = resolveAgentDir();
      const config = loadSubagentsConfig(agentDir);
      const releaseLock = await acquireWriteLock(agentDir, {
        timeoutMs: config.writeLockTimeoutMs,
      });
      releases.set(event.toolCallId, releaseLock);
      const timer = setTimeout(() => release(event.toolCallId), holdTimeoutMs);
      timer.unref?.();
      timers.set(event.toolCallId, timer);
    });

    pi.on("tool_result", (event) => {
      const subagentId = process.env.PI_SUBAGENT_ID;
      if (subagentId) {
        try {
          const store = new SubagentStore(resolveAgentDir());
          store.update(subagentId, {
            activeTool: undefined,
            activeToolStartedAt: undefined,
          });
        } catch {
          // Best-effort
        }
      }
      release(event.toolCallId);
    });

    pi.on("session_shutdown", () => {
      const subagentId = process.env.PI_SUBAGENT_ID;
      if (subagentId) {
        try {
          const store = new SubagentStore(resolveAgentDir());
          store.update(subagentId, {
            activeTool: undefined,
            activeToolStartedAt: undefined,
          });
        } catch {
          // Best-effort
        }
      }
      for (const id of [...releases.keys()]) release(id);
    });
  };
}

export default createChildLockExtension();
