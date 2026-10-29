import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { abortSubagent, listSubagents, sendSubagent } from "./runner.js";
import { createSubagentTool } from "./tool.js";

export interface SubagentStateEventItem {
  id: string;
  agent: string;
  task: string;
  state: string;
  startedAt: number;
  activeTool?: string;
  activeToolStartedAt?: number;
}

export function createSubagentsExtension(
  deps: {
    getAgentDir?: () => string;
    listSubagents?: typeof listSubagents;
  } = {},
): (pi: ExtensionAPI) => void {
  const resolveAgentDir = deps.getAgentDir ?? getAgentDir;
  const list = deps.listSubagents ?? listSubagents;

  return (pi: ExtensionAPI): void => {
    if (process.env.PI_ACP) return;

    let ticker: ReturnType<typeof setInterval> | undefined;

    const stopTicker = () => {
      if (ticker !== undefined) {
        clearInterval(ticker);
        ticker = undefined;
      }
    };

    const emitSubagentsState = (): SubagentStateEventItem[] => {
      const dir = resolveAgentDir();
      const all = list(dir);
      const active = all.filter(
        (s) => s.status === "running" || s.status === "starting",
      );

      const items: SubagentStateEventItem[] = active.map((s) => ({
        id: s.id,
        agent: s.agent,
        task: s.task,
        state: s.status,
        startedAt: s.startedAt,
        ...(s.activeTool !== undefined ? { activeTool: s.activeTool } : {}),
        ...(s.activeToolStartedAt !== undefined
          ? { activeToolStartedAt: s.activeToolStartedAt }
          : {}),
      }));

      pi.events?.emit?.("subagents:state", items);

      if (items.length > 0) {
        if (ticker === undefined) {
          ticker = setInterval(emitSubagentsState, 1000);
          ticker.unref?.();
        }
      } else {
        stopTicker();
      }
      return items;
    };

    pi.registerTool(
      createSubagentTool({
        onSubagentsChange: () => {
          emitSubagentsState();
        },
      }),
    );

    pi.on("session_start", () => {
      emitSubagentsState();
    });

    pi.registerCommand("subagent", {
      description:
        "Manage subagents: /subagent pause|resume|steer <id> [message]",
      handler: async (args, ctx) => {
        const parts = args.trim().split(/\\s+/).filter(Boolean);
        const action = parts[0];
        const id = parts[1];
        if (!action || !id) {
          if (ctx.hasUI) {
            ctx.ui.notify(
              "Usage: /subagent pause|resume|steer <id> [message]",
              "info",
            );
          }
          return;
        }
        const agentDir = resolveAgentDir();
        if (action === "pause") {
          try {
            await abortSubagent(agentDir, id);
            if (ctx.hasUI) ctx.ui.notify(`Paused subagent ${id}`, "info");
          } catch (e) {
            if (ctx.hasUI)
              ctx.ui.notify(
                `Failed to pause: ${e instanceof Error ? e.message : String(e)}`,
                "error",
              );
          }
          emitSubagentsState();
          return;
        }
        if (action === "resume") {
          if (ctx.hasUI)
            ctx.ui.notify(`Resume not yet implemented for ${id}`, "info");
          return;
        }
        if (action === "steer") {
          const message = parts.slice(2).join(" ").trim();
          if (!message) {
            if (ctx.hasUI)
              ctx.ui.notify("Usage: /subagent steer <id> <message>", "error");
            return;
          }
          try {
            await sendSubagent(agentDir, id, { type: "steer", message });
            if (ctx.hasUI) ctx.ui.notify(`Steered subagent ${id}`, "info");
          } catch (e) {
            if (ctx.hasUI)
              ctx.ui.notify(
                `Failed to steer: ${e instanceof Error ? e.message : String(e)}`,
                "error",
              );
          }
          return;
        }
        if (ctx.hasUI) {
          ctx.ui.notify(
            "Usage: /subagent pause|resume|steer <id> [message]",
            "info",
          );
        }
      },
    });

    pi.on("session_shutdown", () => {
      stopTicker();
    });
  };
}

export default function (pi: ExtensionAPI): void {
  createSubagentsExtension()(pi);
}
