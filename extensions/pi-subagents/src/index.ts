import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { isPermissionError } from "@hollowheap/core/config";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import type { AgentConfig } from "./agents.js";
import { subagentAlertTracker } from "./alerts.js";
import {
  type SubagentsSettings,
  loadSubagentsConfig,
  saveSubagentsSettings,
} from "./config.js";
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
    let lastActiveCount = 0;
    let lastCtx: ExtensionContext | undefined;
    let lastStates: Array<{
      id: string;
      status: string;
      agent: string;
      task: string;
    }> = [];
    let sessionAgents = new Map<string, AgentConfig>();

    const syncSubagentsSnapshot = async (
      all?: Array<{
        id: string;
        agent: string;
        status: string;
        task?: string;
        activeTool?: string;
      }>,
    ) => {
      if (!lastCtx?.sessionManager) return;
      try {
        const fullList = all ?? (await list(resolveAgentDir()));
        const active = fullList.filter(
          (s) => s.status === "running" || s.status === "starting",
        );
        const items = active.map((s) => ({
          id: s.id,
          agent: s.agent,
          status: s.status,
          ...(s.task !== undefined ? { task: s.task } : {}),
          ...(s.activeTool !== undefined ? { activeTool: s.activeTool } : {}),
        }));
        updateSessionSnapshot(lastCtx.sessionManager, "subagents", {
          running: active.length,
          total: fullList.length,
          sessionDefinitions: [...sessionAgents.keys()],
          items,
          updatedAt: Date.now(),
        });
      } catch {
        // Snapshot updates must not throw
      }
    };

    const publishStatusline = (count: number) => {
      lastActiveCount = count;
      pi.events?.emit?.("statusline:values", {
        name: "subagents",
        text: count > 0 ? `${count} subagent${count === 1 ? "" : "s"}` : "",
      });
    };

    pi.events?.on?.("statusline:request", (data: unknown) => {
      if (typeof data === "object" && data !== null) {
        const names = (data as { names?: unknown }).names;
        if (Array.isArray(names) && !names.includes("subagents")) return;
      }
      publishStatusline(lastActiveCount);
    });

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
      void syncSubagentsSnapshot();
    };

    const deleteSessionAgent = (name: string): boolean => {
      if (!sessionAgents.has(name)) return false;
      pi.appendEntry(SUBAGENT_DEFINITION_DELETE_TYPE, { name });
      sessionAgents.delete(name);
      void syncSubagentsSnapshot();
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
        publishStatusline(items.length);
        void subagentAlertTracker.observe(all);
        void syncSubagentsSnapshot(all);

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
        publishStatusline(0);
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
      const { showMarkdownPager } = await import("@hollowheap/tui/pager");
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
        const { showFuzzyPicker } = await import("@hollowheap/tui/picker");
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
      pi,
      onSubagentsChange: () => {
        void emitSubagentsState();
      },
      getSessionAgents: () => [...sessionAgents.values()],
      defineSessionAgent,
      deleteSessionAgent,
    });
    pi.registerTool(tool);

    pi.on("session_start", (_event, ctx) => {
      lastCtx = ctx;
      restoreSessionAgents(ctx);
      void emitSubagentsState();
    });

    pi.on("session_tree", (_event, ctx) => {
      lastCtx = ctx;
      restoreSessionAgents(ctx);
      void syncSubagentsSnapshot();
    });

    pi.registerCommand("subagent", {
      description:
        "Manage subagents: /subagent [logs] [id] | pause|resume|steer <id> [message] | settings|config",
      getArgumentCompletions: (prefix: string) => {
        const parts = prefix.trimStart().split(/\s+/);
        const actions = [
          "logs",
          "pause",
          "resume",
          "steer",
          "settings",
          "config",
        ];
        if (parts.length === 1) {
          return actions
            .filter((action) =>
              action.startsWith((parts[0] ?? "").toLowerCase()),
            )
            .map((action) => ({ value: action, label: action }));
        }
        const first = (parts[0] ?? "").toLowerCase();
        if (first === "settings" || first === "config" || parts.length > 2) {
          return null;
        }
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
        lastCtx = ctx;
        const parts = args.trim().split(/\s+/).filter(Boolean);
        const action = parts[0];
        const lowerAction = action?.toLowerCase();
        const id = parts[1];
        const agentDir = resolveAgentDir();
        if (lowerAction === "settings" || lowerAction === "config") {
          const config = loadSubagentsConfig(agentDir);
          if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
            if (ctx.hasUI) {
              for (const diagnostic of config.diagnostics) {
                ctx.ui.notify(
                  `pi-subagents: ${diagnostic}`,
                  isPermissionError(diagnostic) ? "error" : "warning",
                );
              }
              ctx.ui.notify(
                `Subagent settings require TUI mode; edit ${config.path}`,
                "info",
              );
            }
            return;
          }
          for (const diagnostic of config.diagnostics) {
            ctx.ui.notify(
              `pi-subagents: ${diagnostic}`,
              isPermissionError(diagnostic) ? "error" : "warning",
            );
          }
          let saved = false;
          const { showSubagentsSettings } = await import("./settings.js");
          await showSubagentsSettings(
            ctx,
            config,
            (settings: SubagentsSettings) => {
              try {
                saveSubagentsSettings(agentDir, settings);
                saved = true;
              } catch (error) {
                ctx.ui.notify(
                  `pi-subagents: failed to save settings: ${error instanceof Error ? error.message : String(error)}`,
                  "error",
                );
              }
            },
          );
          if (saved) ctx.ui.notify("Subagent settings saved", "info");
          return;
        }
        if (!action || (action === "logs" && !id)) {
          await pickSubagent(ctx);
          return;
        }
        if (!id) {
          if (ctx.hasUI) {
            ctx.ui.notify(
              "Usage: /subagent logs|pause|resume|steer <id> [message] | settings|config",
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

export * from "./tool.js";
export * from "./upstream.js";
export * from "./workspace.js";

export default function (pi: ExtensionAPI): void {
  createSubagentsExtension()(pi);
}
