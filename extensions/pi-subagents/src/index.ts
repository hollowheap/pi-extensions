import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { errorMessage, sanitizeTerminalText } from "@hollowheap/core/format";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { appendSessionEntry, readBranchEntries } from "@hollowheap/core/state";
import { createStatuslinePublisher } from "@hollowheap/core/statusline";
import { canOverlay, hostUi, notify } from "@hollowheap/pi-ui/host";
import { runSettingsCommand } from "@hollowheap/pi-ui/settings";
import { prefixCompletions } from "@hollowheap/ui/autocomplete";
import { escapeMarkdownInline } from "@hollowheap/ui/thinking";
import {
  formatSubagentWidget,
  mountWidgetProviders,
  registerWidgetProvider,
} from "@hollowheap/ui/widget";
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
  attachSubagent,
  listSubagents,
  readSubagentLog,
  sendSubagent,
} from "./runner.js";
import {
  type SubagentsSettings,
  loadSubagentsConfig,
  saveSubagentsSettings,
} from "./settings.js";
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
  label: string;
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
    let disposed = false;
    let lastCtx: ExtensionContext | undefined;
    let lastStates: Array<{
      id: string;
      status: string;
      agent: string;
      task: string;
    }> = [];
    let widgetSubagents: SubagentStateEventItem[] = [];
    let sessionAgents = new Map<string, AgentConfig>();

    const disposeWidgetProvider = registerWidgetProvider({
      name: "subagents",
      label: "Subagents",
      render: (width) =>
        formatSubagentWidget(widgetSubagents, {
          width: width >= 80 ? width : 0,
        }),
    });

    const updateUI = (ctx?: ExtensionContext) => {
      const target = ctx ?? lastCtx;
      if (!target?.hasUI || typeof hostUi(target).setWidget !== "function") {
        return;
      }
      mountWidgetProviders(target);
    };

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

    let lastActiveCount = 0;
    const statusline = createStatuslinePublisher(pi.events, "subagents", () =>
      lastActiveCount > 0
        ? `${lastActiveCount} subagent${lastActiveCount === 1 ? "" : "s"}`
        : "",
    );

    const publishStatusline = (count: number) => {
      lastActiveCount = count;
      statusline.publish();
    };

    const restoreSessionAgents = (ctx: ExtensionContext): void => {
      sessionAgents = definitionsFromEntries(
        readBranchEntries(ctx.sessionManager),
      );
    };

    const defineSessionAgent = (definition: SessionAgentDefinition): void => {
      appendSessionEntry(
        pi,
        lastCtx?.sessionManager,
        SUBAGENT_DEFINITION_TYPE,
        definition,
      );
      sessionAgents.set(definition.name, definitionToAgent(definition));
      void syncSubagentsSnapshot();
    };

    const deleteSessionAgent = (name: string): boolean => {
      if (!sessionAgents.has(name)) return false;
      appendSessionEntry(
        pi,
        lastCtx?.sessionManager,
        SUBAGENT_DEFINITION_DELETE_TYPE,
        { name },
      );
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
      if (emitting || disposed) return [];
      emitting = true;
      try {
        const dir = resolveAgentDir();
        const all = await list(dir);
        if (disposed) return [];
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
          label: subagentDisplayName(s, visible),
          agent: s.agent,
          task: s.task,
          state: s.status,
          startedAt: s.startedAt,
          ...(s.activeTool !== undefined ? { activeTool: s.activeTool } : {}),
          ...(s.activeToolStartedAt !== undefined
            ? { activeToolStartedAt: s.activeToolStartedAt }
            : {}),
        }));

        widgetSubagents = items;
        updateUI();
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
        if (disposed) return [];
        widgetSubagents = [];
        updateUI();
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
        if (ctx.hasUI) notify(ctx, `Unknown subagent ${id}`, "error");
        return;
      }
      const log = readSubagentLog(resolveAgentDir(), id);
      const text = sanitizeTerminalText(formatSubagentLog(log, raw));
      const name = sanitizeTerminalText(subagentDisplayName(state, lastStates));
      const workspace = sanitizeTerminalText(state.workspace ?? state.agent);
      const { showMarkdownPager } = await import("@hollowheap/pi-ui/pager");
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
        if (ctx.hasUI) notify(ctx, "No subagents found.", "info");
        return;
      }
      if (canOverlay(ctx)) {
        const { showFuzzyPicker } = await import("@hollowheap/pi-ui/picker");
        const picked = await showFuzzyPicker(ctx, {
          title: "Select a subagent",
          items: all.map((state) => ({
            value: state.id,
            label: subagentDisplayName(state, all),
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
        notify(
          ctx,
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

    let turnStartedAt: number | undefined;
    pi.on("turn_start", () => {
      turnStartedAt = Date.now();
    });

    pi.on("turn_end", (event, ctx) => {
      const startedAt = turnStartedAt;
      const parentSession = ctx?.sessionManager?.getSessionId?.();
      turnStartedAt = undefined;
      const stopReason = (
        event as { message?: { stopReason?: unknown } } | undefined
      )?.message?.stopReason;
      const aborted =
        stopReason === "aborted" ||
        (ctx as { signal?: { aborted?: boolean } } | undefined)?.signal
          ?.aborted === true;
      if (!aborted || startedAt === undefined || parentSession === undefined) {
        return;
      }
      void (async () => {
        try {
          const dir = resolveAgentDir();
          const scoped = (await list(dir)).filter(
            (state) =>
              (state.status === "running" || state.status === "starting") &&
              state.startedAt >= startedAt &&
              state.parentSession === parentSession &&
              isInProject(state, ctx?.cwd),
          );
          if (scoped.length === 0) return;
          await Promise.all(
            scoped.map((state) =>
              abortSubagent(dir, state.id).catch(() => undefined),
            ),
          );

          void emitSubagentsState();
        } catch {
          // Turn cleanup must never break the agent turn.
        }
      })();
    });

    pi.registerCommand("subagent", {
      description:
        "Manage subagents: /subagent [view] [id] | list | pause|resume|steer <id> [message] | settings",
      getArgumentCompletions: (prefix: string) => {
        const parts = prefix.trimStart().split(/\s+/);
        const idActions = ["view", "pause", "resume", "steer"];
        const actions = [...idActions, "settings", "list"];
        if (parts.length === 1) {
          return prefixCompletions(parts[0] ?? "", actions);
        }
        const first = (parts[0] ?? "").toLowerCase();
        // Allow id completion for steer while the id is still being typed,
        // even when a trailing space has started the free-text message part.
        if (!idActions.includes(first)) {
          return null;
        }
        if (parts.length > 2 && first !== "steer") {
          return null;
        }
        if (parts.length > 3) {
          return null;
        }
        return prefixCompletions(
          parts[1] ?? "",
          lastStates.map((state) => state.id),
        ).map(({ value }) => {
          const state = lastStates.find((item) => item.id === value);
          return {
            value: `${first} ${value}`,
            label: value,
            description: `${state?.status ?? ""} @${sanitizeTerminalText(state?.agent ?? "")}: ${sanitizeTerminalText(state?.task ?? "")}`,
          };
        });
      },
      handler: async (args, ctx) => {
        lastCtx = ctx;
        const parts = args.trim().split(/\s+/).filter(Boolean);
        const lowerAction = parts[0]?.toLowerCase();
        const id = parts[1];
        const agentDir = resolveAgentDir();
        if (lowerAction === "list") {
          await pickSubagent(ctx);
          return;
        }
        if (lowerAction === "settings") {
          const config = loadSubagentsConfig(agentDir);
          await runSettingsCommand(ctx, {
            prefix: "pi-subagents",
            title: "Subagent settings",
            configPath: config.path,
            diagnostics: config.diagnostics,
            savedMessage: "Subagent settings saved",
            open: async () => {
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
                    saved = false;
                    if (ctx.hasUI) {
                      notify(
                        ctx,
                        `pi-subagents: failed to save settings: ${errorMessage(error)}`,
                        "error",
                      );
                    }
                  }
                },
              );
              return saved;
            },
          });
          return;
        }
        if (!lowerAction || (lowerAction === "view" && !id)) {
          await pickSubagent(ctx);

          return;
        }
        if (!id) {
          if (ctx.hasUI) {
            notify(
              ctx,
              "Usage: /subagent view|pause|resume|steer <id> [message] | settings",
              "info",
            );
          }
          return;
        }
        if (lowerAction === "view") {
          const raw = parts.includes("raw");
          await openSubagentLog(ctx, id, undefined, raw);
          return;
        }
        if (lowerAction === "pause") {
          try {
            const current = await attachSubagent(agentDir, id);
            if (current === undefined || !isInProject(current, ctx.cwd)) {
              if (ctx.hasUI) notify(ctx, `Unknown subagent ${id}`, "error");
              return;
            }
            await abortSubagent(agentDir, id);
            if (ctx.hasUI) notify(ctx, `Paused subagent ${id}`, "info");
          } catch (e) {
            if (ctx.hasUI)
              notify(ctx, `Failed to pause: ${errorMessage(e)}`, "error");
          }
          void emitSubagentsState();
          return;
        }
        if (lowerAction === "resume") {
          const result = await tool.execute(
            "command",
            { action: "resume", id },
            undefined,
            undefined,
            ctx as never,
          );
          const details = result.details as { error?: string } | undefined;
          if (ctx.hasUI) {
            notify(
              ctx,
              details?.error === undefined
                ? `Resumed subagent ${id}`
                : `Failed to resume: ${details.error}`,
              details?.error === undefined ? "info" : "error",
            );
          }
          return;
        }
        if (lowerAction === "steer") {
          const message = parts.slice(2).join(" ").trim();
          if (!message) {
            if (ctx.hasUI)
              notify(ctx, "Usage: /subagent steer <id> <message>", "error");
            return;
          }
          try {
            const current = await attachSubagent(agentDir, id);
            if (current === undefined || !isInProject(current, ctx.cwd)) {
              if (ctx.hasUI) notify(ctx, `Unknown subagent ${id}`, "error");
              return;
            }
            await sendSubagent(agentDir, id, { type: "steer", message });
            if (ctx.hasUI) notify(ctx, `Steered subagent ${id}`, "info");
          } catch (e) {
            if (ctx.hasUI)
              notify(ctx, `Failed to steer: ${errorMessage(e)}`, "error");
          }
          return;
        }
        if (ctx.hasUI) {
          notify(
            ctx,
            "Usage: /subagent view|pause|resume|steer <id> [message] | settings",
            "info",
          );
        }
      },
    });

    pi.registerShortcut?.(Key.alt("s"), {
      description: "Browse subagent work",
      handler: async (ctx) => {
        await pickSubagent(ctx);
      },
    });

    let transcriptCursor = 0;
    const showAdjacentTranscript = async (
      ctx: ExtensionContext,
      step: -1 | 1,
    ): Promise<void> => {
      const all = (await list(resolveAgentDir())).filter((state) =>
        isInProject(state, ctx.cwd),
      );
      if (all.length === 0) {
        if (ctx.hasUI) notify(ctx, "No subagents found.", "info");
        return;
      }
      transcriptCursor = (transcriptCursor + step + all.length) % all.length;
      const state = all[transcriptCursor];
      if (state !== undefined) await openSubagentLog(ctx, state.id, state);
    };

    pi.registerShortcut?.(Key.alt("left"), {
      description: "Previous subagent transcript",
      handler: async (ctx) => {
        await showAdjacentTranscript(ctx, -1);
      },
    });

    pi.registerShortcut?.(Key.alt("right"), {
      description: "Next subagent transcript",
      handler: async (ctx) => {
        await showAdjacentTranscript(ctx, 1);
      },
    });

    pi.on("session_shutdown", () => {
      disposed = true;
      stopTicker();
      lastActiveCount = 0;
      statusline.publish("");
      statusline.dispose();
      disposeWidgetProvider();
      lastCtx = undefined;
      turnStartedAt = undefined;
      lastStates = [];
      widgetSubagents = [];
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
