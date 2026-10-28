import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { listSubagents } from "./runner.js";
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

    pi.on("session_shutdown", () => {
      stopTicker();
    });
  };
}

export default function (pi: ExtensionAPI): void {
  createSubagentsExtension()(pi);
}
