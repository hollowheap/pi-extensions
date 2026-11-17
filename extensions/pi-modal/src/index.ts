import { existsSync } from "node:fs";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Loader } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { getTuiConfigPath } from "@hollowheap/core/tui-config";
import { createWorkingIndicator } from "@hollowheap/tui/spinner";
import {
  getActiveTuiConfig,
  loadAndActivateTuiConfig,
} from "@hollowheap/tui/state";
import {
  SHIMMER_BASE_INTERVAL_MS,
  formatOneLineThinkingText,
  renderThinkingShimmerFrame,
  stripMarkdownInline,
} from "@hollowheap/tui/thinking";
import { showCodeViewer } from "@hollowheap/tui/viewer";
import { ModalEditor } from "./editor.js";
import { loadModalConfig } from "./keymap.js";
import { normalizeAgentMarkdown } from "./markdown-normalize.js";
import { wrapToolRenderer } from "./panel.js";
import { handleSkillInput, registerSkillAutocomplete } from "./skills.js";
import { formatTuiStatus, showTuiSettings } from "./tui-settings.js";
import { formatVimKeys } from "./vimkeys.js";

export { ModalEditor } from "./editor.js";
export * from "./keymap.js";
export * from "./markdown-normalize.js";
export * from "./skills.js";
export * from "./panel.js";
export * from "./tui-settings.js";

const THINKING_PREFIXES = {
  standard: "Thinking: ",
  terse: "think: ",
  playful: "Pondering: ",
} as const;

const LOADER_INDICATOR_PATCH = Symbol.for(
  "@hollowheap/pi-modal/loader-indicator-patch",
);
let loaderIndicatorTheme: unknown;

/** Style host-owned loaders (shell execution, compaction) like our spinner. */
function installLoaderIndicatorPatch(): void {
  const registry = globalThis as unknown as Record<symbol, unknown>;
  if (registry[LOADER_INDICATOR_PATCH] === true) return;
  registry[LOADER_INDICATOR_PATCH] = true;

  const original = Loader.prototype.setIndicator;
  Loader.prototype.setIndicator = function (indicator) {
    if (indicator === undefined) {
      const cfg = getActiveTuiConfig();
      if (cfg.loadingIndicator !== "host") {
        const custom = createWorkingIndicator(
          cfg.loadingIndicator,
          loaderIndicatorTheme,
          cfg.colored,
        );
        if (custom !== undefined) {
          original.call(this, custom);
          return;
        }
      }
    }
    original.call(this, indicator);
  };
}

function lastCodemodeFromSession(ctx: ExtensionContext): string | undefined {
  let code: string | undefined;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type !== "toolCall" || block.name !== "codemode") continue;
      const value = block.arguments?.code;
      if (typeof value === "string") code = value;
    }
  }
  return code;
}

export const MODAL_EXPAND_TYPE = "hollowheap.modal.expand";

function readPersistedExpanded(ctx: ExtensionContext): boolean | undefined {
  const getBranch = (ctx.sessionManager as { getBranch?: () => unknown[] })
    ?.getBranch;
  if (typeof getBranch !== "function") return undefined;
  let expanded: boolean | undefined;
  for (const raw of getBranch.call(ctx.sessionManager)) {
    const entry = raw as {
      type?: unknown;
      customType?: unknown;
      data?: { expanded?: unknown };
    };
    if (
      entry?.type === "custom" &&
      entry.customType === MODAL_EXPAND_TYPE &&
      typeof entry.data?.expanded === "boolean"
    ) {
      expanded = entry.data.expanded;
    }
  }
  return expanded;
}

export default function (pi: ExtensionAPI): void {
  installLoaderIndicatorPatch();
  let lastCodemodeCode: string | undefined;
  let lastToolCall:
    | { name: string; input: Record<string, unknown> }
    | undefined;
  let persistedExpand: boolean | undefined;
  let activeCtx: ExtensionContext | undefined;
  let activeEditor: ModalEditor | undefined;
  let activeTui:
    | {
        requestRender?: (force?: boolean) => void;
      }
    | undefined;

  const applyWorkingIndicator = (ctx: ExtensionContext | undefined): void => {
    if (!ctx?.hasUI || typeof ctx.ui?.setWorkingIndicator !== "function") {
      return;
    }
    const cfg = getActiveTuiConfig();
    loaderIndicatorTheme = ctx.ui.theme;
    ctx.ui.setWorkingIndicator(
      createWorkingIndicator(cfg.loadingIndicator, ctx.ui.theme, cfg.colored),
    );
  };

  const publishModalSnapshot = (ctx: ExtensionContext | undefined): void => {
    if (!ctx?.sessionManager) return;
    const toolsExpanded =
      typeof ctx.ui?.getToolsExpanded === "function"
        ? ctx.ui.getToolsExpanded()
        : persistedExpand;
    updateSessionSnapshot(ctx.sessionManager, "modal", {
      ...(toolsExpanded !== undefined ? { toolsExpanded } : {}),
      ...(lastToolCall ? { lastTool: lastToolCall.name } : {}),
      hasLastCodemode: Boolean(
        lastCodemodeCode ??
          (typeof (ctx.sessionManager as { getBranch?: unknown })?.getBranch ===
          "function"
            ? lastCodemodeFromSession(ctx)
            : undefined),
      ),
      updatedAt: Date.now(),
    });
  };

  pi.registerToolRenderer?.((toolName, next) => {
    const base = next();
    if (getActiveTuiConfig().panel.enabled) {
      return wrapToolRenderer(
        toolName,
        base,
        () => {
          const active = getActiveTuiConfig();
          return {
            ...active.panel,
            verbPack: active.verbPack,
            surface:
              active.panel.surface && active.panel.surface !== "transparent"
                ? active.panel.surface
                : active.overlaySurface,
          };
        },
        { requestRender: () => activeTui?.requestRender?.() },
      );
    }
    const renderCall = base?.renderCall;
    if (toolName !== "codemode" || renderCall === undefined) return base;
    return {
      ...base,
      renderCall(args, theme, context) {
        return renderCall(args, theme, { ...context, expanded: true });
      },
    };
  });

  pi.registerMarkdownTransformer?.((markdown, context) => {
    const cfg = getActiveTuiConfig();
    if (context.messageType === "assistant-thinking") {
      if (cfg.thinkingVerbosity === "verbose") return markdown;
      if (cfg.thinkingVerbosity === "none") return "";
      const line = formatOneLineThinkingText(markdown, context.availableWidth, {
        pick: "first",
        prefix: THINKING_PREFIXES[cfg.verbPack],
      });
      if (context.isStreaming && cfg.thinkingAnimate && cfg.colored) {
        return renderThinkingShimmerFrame(
          stripMarkdownInline(line),
          Math.floor(Date.now() / SHIMMER_BASE_INTERVAL_MS),
          activeCtx?.ui?.theme,
          true,
        );
      }
      return line;
    }
    return cfg.markdownRender ? normalizeAgentMarkdown(markdown) : markdown;
  });

  const TUI_SUBCOMMANDS = ["settings", "config", "status"] as const;
  const createTuiCommand = () => ({
    description:
      "Inspect or configure TUI border, colors, spinner, markdown, thinking, and panel settings",
    getArgumentCompletions: (prefix: string) => {
      const lower = prefix.trim().toLowerCase();
      return TUI_SUBCOMMANDS.filter((sub) => sub.startsWith(lower)).map(
        (sub) => ({ value: sub, label: sub }),
      );
    },
    handler: async (args: string, ctx: ExtensionContext) => {
      activeCtx = ctx;
      const sub = args.trim().toLowerCase();
      if (sub === "status") {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `pi-modal TUI: ${formatTuiStatus(getActiveTuiConfig())}`,
            "info",
          );
        }
        return;
      }
      if (sub === "" || sub === "settings" || sub === "config") {
        if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
          if (ctx.hasUI) {
            ctx.ui.notify(
              `pi-modal TUI: ${formatTuiStatus(getActiveTuiConfig())} (interactive settings require TUI mode)`,
              "info",
            );
          }
          return;
        }
        await showTuiSettings(ctx, getAgentDir(), (next) => {
          applyWorkingIndicator(ctx);
          activeEditor?.clearExplicitUiOverrides();
          activeTui?.requestRender?.(true);
          pi.events?.emit?.("tui:config-changed", next);
        });
        activeEditor?.clearExplicitUiOverrides();
        activeTui?.requestRender?.(true);
        return;
      }
      if (ctx.hasUI) {
        ctx.ui.notify("Usage: /tui [settings|config|status]", "error");
      }
    },
  });
  pi.registerCommand("tui", createTuiCommand());
  pi.registerCommand("ui", createTuiCommand());

  pi.registerCommand("expand", {
    description:
      "Expand or collapse tool output, including codemode scripts and nested calls",
    handler: async (args, ctx) => {
      const mode = args.trim().toLowerCase();
      let nextExpanded: boolean;
      if (mode === "" || mode === "toggle") {
        nextExpanded = !ctx.ui.getToolsExpanded();
      } else if (mode === "on" || mode === "expand") {
        nextExpanded = true;
      } else if (mode === "off" || mode === "collapse") {
        nextExpanded = false;
      } else {
        ctx.ui.notify("Usage: /expand [on|off|toggle]", "error");
        return;
      }
      ctx.ui.setToolsExpanded(nextExpanded);
      persistedExpand = nextExpanded;
      pi.appendEntry?.(MODAL_EXPAND_TYPE, { expanded: nextExpanded });
      publishModalSnapshot(ctx);
      ctx.ui.notify(
        `pi-modal: tool output ${ctx.ui.getToolsExpanded() ? "expanded" : "collapsed"}`,
      );
    },
  });

  const showLastCodemode = async (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    const code = lastCodemodeCode ?? lastCodemodeFromSession(ctx);
    if (code !== undefined) {
      await showCodeViewer(
        ctx,
        "Last codemode script",
        sanitizeTerminalText(code),
      );
      return;
    }
    if (lastToolCall !== undefined) {
      await showCodeViewer(
        ctx,
        `Last tool call: ${lastToolCall.name}`,
        JSON.stringify(lastToolCall.input, null, 2),
      );
      return;
    }
    ctx.ui.notify("pi-modal: no codemode script yet", "info");
  };

  pi.on("tool_call", (event, ctx) => {
    if (event.parentToolCallId === undefined) {
      lastToolCall = {
        name: event.toolName,
        input: event.input as Record<string, unknown>,
      };
    }
    if (event.toolName === "codemode") {
      const code = event.input.code;
      if (typeof code === "string") lastCodemodeCode = code;
    }
    publishModalSnapshot(ctx);
  });

  const syncFromBranch = (ctx: ExtensionContext) => {
    lastCodemodeCode = undefined;
    lastToolCall = undefined;
    persistedExpand = readPersistedExpanded(ctx);
    if (
      persistedExpand !== undefined &&
      typeof ctx.ui?.setToolsExpanded === "function"
    ) {
      ctx.ui.setToolsExpanded(persistedExpand);
    }
    publishModalSnapshot(ctx);
  };

  pi.registerShortcut("ctrl+shift+o", {
    description: "Open the last codemode script",
    handler: showLastCodemode,
  });

  const showVimKeys = async (ctx: ExtensionContext) => {
    const config = loadModalConfig(getAgentDir(), (message) =>
      ctx.ui.notify(`pi-modal: ${message}`, "warning"),
    );
    await showCodeViewer(ctx, "pi-modal keybinds", formatVimKeys(config));
  };

  pi.registerCommand("vimkeys", {
    description: "Show pi-modal vim mode keybindings",
    handler: async (_args, ctx) => showVimKeys(ctx),
  });

  pi.registerShortcut("ctrl+shift+k", {
    description: "Show vim mode keybinds",
    handler: showVimKeys,
  });

  pi.on("input", (event, _ctx) => {
    return handleSkillInput(event, pi);
  });

  pi.on("session_tree", (_event, ctx) => {
    syncFromBranch(ctx);
    // Reinstall the modal editor after branch navigation; the host may have
    // disposed the previous editor component when the session was replaced.
    if (ctx.hasUI && typeof ctx.ui.setEditorComponent === "function") {
      const config = loadModalConfig(getAgentDir(), (message) =>
        ctx.ui.notify(`pi-modal: ${message}`, "warning"),
      );
      if (config.enabled !== false) {
        const hasTuiConfigFile = existsSync(getTuiConfigPath(getAgentDir()));
        const editorConfig =
          config.borderStyleExplicit && !hasTuiConfigFile
            ? config
            : { ...config, borderStyle: undefined };
        applyWorkingIndicator(ctx);
        ctx.ui.setEditorComponent((tui, theme, kb) => {
          activeTui = tui as unknown as typeof activeTui;
          activeEditor = new ModalEditor(
            tui,
            theme,
            kb,
            editorConfig,
            undefined,
            ctx.ui.theme,
          );
          return activeEditor;
        });
      }
    }
  });

  pi.on("session_compact", (_event, ctx) => {
    if (persistedExpand !== undefined) {
      pi.appendEntry(MODAL_EXPAND_TYPE, { expanded: persistedExpand });
    }
    publishModalSnapshot(ctx);
  });

  pi.on("session_start", (_event, ctx) => {
    activeCtx = ctx;
    syncFromBranch(ctx);
    loadAndActivateTuiConfig(getAgentDir(), (msg) =>
      ctx.ui?.notify?.(`pi-modal: ${msg}`, "warning"),
    );
    if (ctx.hasUI && typeof ctx.ui.addAutocompleteProvider === "function") {
      registerSkillAutocomplete(pi, ctx);
    }
    if (!ctx.hasUI || typeof ctx.ui.setEditorComponent !== "function") return;
    const config = loadModalConfig(getAgentDir(), (message) =>
      ctx.ui.notify(`pi-modal: ${message}`, "warning"),
    );
    if (config.enabled === false) return;
    const hasTuiConfigFile = existsSync(getTuiConfigPath(getAgentDir()));
    const editorConfig =
      config.borderStyleExplicit && !hasTuiConfigFile
        ? config
        : { ...config, borderStyle: undefined };
    applyWorkingIndicator(ctx);
    ctx.ui.setEditorComponent((tui, theme, kb) => {
      activeTui = tui as unknown as typeof activeTui;
      activeEditor = new ModalEditor(
        tui,
        theme,
        kb,
        editorConfig,
        undefined,
        ctx.ui.theme,
      );
      return activeEditor;
    });
  });
}
