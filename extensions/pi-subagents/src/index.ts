import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { isPermissionError } from "@hollowheap/core/config";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { escapeMarkdownInline } from "@hollowheap/tui/thinking";
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
  attachSubagent,
  listSubagents,
  readSubagentLog,
  sendSubagent,
} from "./runner.js";
import {
  type SubagentState,
  clearSubagentWorkspace,
  isInProject,
  subagentDisplayName,
} from "./state.js";
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

export function formatSubagentLog(log: string, raw: boolean): string {
  if (raw) return log.trim() === "" ? "(no output)" : log;
  const lines = log.split(/\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      out.push(trimmed);
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const record = parsed as Record<string, unknown>;
    const type = record.type;
    if (type === "message_end" || type === "message") {
      const message = record.message as
        | { role?: unknown; content?: unknown }
        | undefined;
      if (message?.role !== "assistant") continue;
      const content = message.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .filter(
                  (part): part is { type: "text"; text: string } =>
                    typeof part === "object" &&
                    part !== null &&
                    (part as { type?: unknown }).type === "text" &&
                    typeof (part as { text?: unknown }).text === "string",
                )
                .map((part) => part.text)
                .join("\n")
            : "";
      const cleaned = text.trim();
      if (cleaned !== "") out.push(cleaned);
      continue;
    }
    if (type === "tool_call" || type === "tool_execution_start") {
      const toolName =
        typeof record.toolName === "string"
          ? record.toolName
          : typeof record.name === "string"
            ? record.name
            : "tool";
      const args = record.args ?? record.arguments ?? record.input;
      const summary =
        typeof args === "object" && args !== null
          ? Object.entries(args as Record<string, unknown>)
              .slice(0, 3)
              .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
              .join(", ")
          : String(args ?? "").slice(0, 80);
      out.push(`> ${toolName}${summary ? ` (${summary})` : ""}`);
    }
  }
  if (out.length === 0) {
    return log.trim() === "" ? "(no output)" : log;
  }
  return out.join("\n\n");
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
        project?: string;
        task?: string;
        activeTool?: string;
      }>,
    ) => {
      if (!lastCtx?.sessionManager) return;
      try {
        const fullList = all ?? (await list(resolveAgentDir()));
        const visible = fullList.filter((s) => isInProject(s, lastCtx?.cwd));
        const active = visible.filter(
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
          total: visible.length,
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
        void subagentWorkspaceTracker.cleanupTerminal(all, (id) => {
          clearSubagentWorkspace(dir, id);
        });
        const visible = all.filter((state) => isInProject(state, lastCtx?.cwd));
        lastStates = visible.map((state) => ({
          id: state.id,
          status: state.status,
          agent: state.agent,
          task: state.task,
        }));
        const active = visible.filter(
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
        void subagentAlertTracker.observe(
          visible.map(({ id, status }) => ({ id, status })),
        );
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
      known?: SubagentState,
      raw = false,
    ): Promise<void> => {
      const state = known ?? (await attachSubagent(resolveAgentDir(), id));
      if (state === undefined || !isInProject(state, ctx.cwd)) {
        if (ctx.hasUI) ctx.ui.notify(`Unknown subagent ${id}`, "error");
        return;
      }
      const log = readSubagentLog(resolveAgentDir(), id);
      const text = sanitizeTerminalText(formatSubagentLog(log, raw));
      const name = sanitizeTerminalText(subagentDisplayName(state));
      const workspace = sanitizeTerminalText(state.workspace ?? state.agent);
      const { showMarkdownPager } = await import("@hollowheap/tui/pager");
      await showMarkdownPager(ctx, {
        title: `Subagent ${name}`,
        markdown: `**${escapeMarkdownInline(name)}**\n\n${escapeMarkdownInline(workspace)}\n\n${text}`,
        plainText: text,
      });
    };

    const pickSubagent = async (ctx: ExtensionContext): Promise<void> => {
      const all = (await list(resolveAgentDir())).filter((state) =>
        isInProject(state, ctx.cwd),
      );
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
            label: subagentDisplayName(state),
            description: `${state.status} — @${sanitizeTerminalText(state.agent)}`,
            preview: [
              `${state.status} — @${sanitizeTerminalText(state.agent)}`,
              `model: ${sanitizeTerminalText(state.model ?? "default")}`,
              `workspace: ${sanitizeTerminalText(state.workspace ?? "unknown")}`,
              `task: ${sanitizeTerminalText(state.task)}`,
              `started: ${new Date(state.startedAt).toISOString()}`,
            ],
          })),
          emptyText: "No matching subagents",
        });
        if (picked !== undefined) {
          await openSubagentLog(
            ctx,
            picked,
            all.find((state) => state.id === picked),
          );
        }
        return;
      }
      if (ctx.hasUI) {
        ctx.ui.notify(
          all
            .map(
              (state) =>
                `${state.id} [${state.status}] @${sanitizeTerminalText(state.agent)}: ${sanitizeTerminalText(state.task)}`,
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
        // Allow id completion for steer while the id is still being typed,
        // even when a trailing space has started the free-text message part.
        if (first === "settings" || first === "config") {
          return null;
        }
        if (parts.length > 2 && first !== "steer") {
          return null;
        }
        if (parts.length > 3) {
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
          const raw = parts.includes("raw");
          await openSubagentLog(ctx, id, undefined, raw);
          return;
        }
        if (action === "pause") {
          try {
            const current = await attachSubagent(agentDir, id);
            if (current === undefined || !isInProject(current, ctx.cwd)) {
              if (ctx.hasUI) ctx.ui.notify(`Unknown subagent ${id}`, "error");
              return;
            }
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
            const current = await attachSubagent(agentDir, id);
            if (current === undefined || !isInProject(current, ctx.cwd)) {
              if (ctx.hasUI) ctx.ui.notify(`Unknown subagent ${id}`, "error");
              return;
            }
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
