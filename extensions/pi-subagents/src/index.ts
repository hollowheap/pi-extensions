import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { showMarkdownPager } from "@hollowheap/tui/pager";
import { showFuzzyPicker } from "@hollowheap/tui/picker";
import type { AgentConfig } from "./agents.js";
import { subagentAlertTracker } from "./alerts.js";
import {
  SUBAGENT_DEFINITION_DELETE_TYPE,
  SUBAGENT_DEFINITION_TYPE,
  type SessionAgentDefinition,
  definitionToAgent,
  definitionsFromEntries,
} from "./definitions.js";
import {
  abortSubagent,
  listSubagents,
  readSubagentLog,
  sendSubagent,
} from "./runner.js";
import { createSubagentTool } from "./tool.js";
import { subagentWorkspaceTracker } from "./workspace.js";

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
    let emitting = false;
    let lastStates: Array<{
      id: string;
      status: string;
      agent: string;
      task: string;
    }> = [];
    let sessionAgents = new Map<string, AgentConfig>();

    const restoreSessionAgents = (ctx: ExtensionContext): void => {
      try {
        sessionAgents = definitionsFromEntries(
          ctx.sessionManager?.getBranch?.(),
        );
      } catch {
        // A failed branch read must not leave definitions from the previous branch active.
        sessionAgents = new Map();
      }
    };

    const defineSessionAgent = (definition: SessionAgentDefinition): void => {
      pi.appendEntry(SUBAGENT_DEFINITION_TYPE, definition);
      sessionAgents.set(definition.name, definitionToAgent(definition));
    };

    const deleteSessionAgent = (name: string): boolean => {
      if (!sessionAgents.has(name)) return false;
      pi.appendEntry(SUBAGENT_DEFINITION_DELETE_TYPE, { name });
      sessionAgents.delete(name);
      return true;
    };

    const stopTicker = () => {
      if (ticker !== undefined) {
        clearInterval(ticker);
        ticker = undefined;
      }
    };

    const emitSubagentsState = async (): Promise<SubagentStateEventItem[]> => {
      if (emitting) return [];
      emitting = true;
      try {
        const dir = resolveAgentDir();
        const all = await list(dir);
        void subagentWorkspaceTracker.cleanupTerminal(all);
        lastStates = all.map((state) => ({
          id: state.id,
          status: state.status,
          agent: state.agent,
          task: state.task,
        }));
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
        void subagentAlertTracker.observe(all);

        if (items.length > 0) {
          if (ticker === undefined) {
            ticker = setInterval(() => {
              void emitSubagentsState();
            }, 1000);
            ticker.unref?.();
          }
        } else {
          stopTicker();
        }
        return items;
      } catch {
        stopTicker();
        return [];
      } finally {
        emitting = false;
      }
    };

    const openSubagentLog = async (
      ctx: ExtensionContext,
      id: string,
    ): Promise<void> => {
      const log = readSubagentLog(resolveAgentDir(), id);
      const text = log.trim() === "" ? "(no output)" : log;
      await showMarkdownPager(ctx, {
        title: `Subagent ${id}`,
        markdown: `~~~~text\n${text}\n~~~~`,
        plainText: text,
      });
    };

    const pickSubagent = async (ctx: ExtensionContext): Promise<void> => {
      const all = await list(resolveAgentDir());
      if (all.length === 0) {
        if (ctx.hasUI) ctx.ui.notify("No subagents found.", "info");
        return;
      }
      if (ctx.mode === "tui" && typeof ctx.ui.custom === "function") {
        const picked = await showFuzzyPicker(ctx, {
          title: "Select a subagent",
          items: all.map((state) => ({
            value: state.id,
            label: state.id,
            description: `${state.status} — @${state.agent}: ${state.task}`,
            preview: [
              `${state.status} — @${state.agent}`,
              `task: ${state.task}`,
              `started: ${new Date(state.startedAt).toISOString()}`,
            ],
          })),
          emptyText: "No matching subagents",
        });
        if (picked !== undefined) await openSubagentLog(ctx, picked);
        return;
      }
      if (ctx.hasUI) {
        ctx.ui.notify(
          all
            .map(
              (state) =>
                `${state.id} [${state.status}] @${state.agent}: ${state.task}`,
            )
            .join("\n"),
          "info",
        );
      }
    };

    const tool = createSubagentTool({
      onSubagentsChange: () => {
        void emitSubagentsState();
      },
      getSessionAgents: () => [...sessionAgents.values()],
      defineSessionAgent,
      deleteSessionAgent,
    });
    pi.registerTool(tool);

    pi.on("session_start", (_event, ctx) => {
      restoreSessionAgents(ctx);
      void emitSubagentsState();
    });

    pi.on("session_tree", (_event, ctx) => {
      restoreSessionAgents(ctx);
    });

    pi.registerCommand("subagent", {
      description:
        "Manage subagents: /subagent [logs] [id] or pause|resume|steer <id> [message]",
      getArgumentCompletions: (prefix: string) => {
        const parts = prefix.trimStart().split(/\s+/);
        const actions = ["logs", "pause", "resume", "steer"];
        if (parts.length === 1) {
          return actions
            .filter((action) =>
              action.startsWith((parts[0] ?? "").toLowerCase()),
            )
            .map((action) => ({ value: action, label: action }));
        }
        if (parts.length > 2) return null;
        const query = (parts[1] ?? "").toLowerCase();
        return lastStates
          .filter((state) => state.id.toLowerCase().startsWith(query))
          .map((state) => ({
            value: state.id,
            label: state.id,
            description: `${state.status} @${state.agent}: ${state.task}`,
          }));
      },
      handler: async (args, ctx) => {
        const parts = args.trim().split(/\s+/).filter(Boolean);
        const action = parts[0];
        const id = parts[1];
        const agentDir = resolveAgentDir();
        if (!action || (action === "logs" && !id)) {
          await pickSubagent(ctx);
          return;
        }
        if (!id) {
          if (ctx.hasUI) {
            ctx.ui.notify(
              "Usage: /subagent logs|pause|resume|steer <id> [message]",
              "info",
            );
          }
          return;
        }
        if (action === "logs") {
          await openSubagentLog(ctx, id);
          return;
        }
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
          void emitSubagentsState();
          return;
        }
        if (action === "resume") {
          const result = await tool.execute(
            "command",
            { action: "resume", id },
            undefined,
            undefined,
            ctx as never,
          );
          const details = result.details as { error?: string } | undefined;
          if (ctx.hasUI) {
            ctx.ui.notify(
              details?.error === undefined
                ? `Resumed subagent ${id}`
                : `Failed to resume: ${details.error}`,
              details?.error === undefined ? "info" : "error",
            );
          }
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
            "Usage: /subagent logs|pause|resume|steer <id> [message]",
            "info",
          );
        }
      },
    });

    pi.on("session_shutdown", () => {
      stopTicker();
      lastStates = [];
      sessionAgents = new Map();
    });
  };
}

export * from "./upstream.js";
export * from "./workspace.js";

export default function (pi: ExtensionAPI): void {
  createSubagentsExtension()(pi);
}
