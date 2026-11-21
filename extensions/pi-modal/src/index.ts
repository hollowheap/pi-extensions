import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  parseSkillBlock,
} from "@earendil-works/pi-coding-agent";
import { Loader } from "@earendil-works/pi-tui";
import { normalizeAgentMarkdown } from "@hollowheap/core/markdown";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { readBranchEntries } from "@hollowheap/core/state";
import { canOverlay, hostUi, notify } from "@hollowheap/pi-ui/host";
import { getPromptChar } from "@hollowheap/pi-ui/prompt-char";
import { prefixCompletions } from "@hollowheap/ui/autocomplete";
import { boxFrame } from "@hollowheap/ui/frame";
import { createWorkingIndicator } from "@hollowheap/ui/spinner";
import {
  bindHostOutputPadding,
  getActiveTuiConfig,
  loadAndActivateTuiConfig,
} from "@hollowheap/ui/state";
import {
  type ThinkingShimmerAnimator,
  createThinkingShimmerAnimator,
  formatThinkingMarkdown,
  getShimmerIntervalMs,
  installThinkingVisibility,
  renderThinkingShimmerFrame,
  stripMarkdownInline,
} from "@hollowheap/ui/thinking";
import {
  codemodePreview,
  withToolOutputDisplay,
} from "@hollowheap/ui/tool-output";
import { ModalEditor } from "./editor.js";
import { installExtensionInputPanel } from "./input-panel.js";
import { loadModalConfig } from "./settings.js";

import { panelRenderConfig, wrapToolRenderer } from "./panel.js";
import { formatTuiStatus, showTuiSettings } from "./settings.js";
import {
  installBashPanel,
  installBranchSummaryPanel,
  installCompactionSummaryPanel,
  installCustomMessagePanel,
  installSkillPanel,
  installUserMessagePanel,
  markSteeredUserMessage,
} from "./skill-panel.js";
import { handleSkillInput, registerSkillAutocomplete } from "./skills.js";
import {
  formatVimHotkeysMarkdown,
  formatVimKeys,
  installHotkeysPanel,
} from "./vimkeys.js";

export { ModalEditor } from "./editor.js";
export * from "./keymap.js";
export { normalizeAgentMarkdown } from "@hollowheap/core/markdown";
export * from "./skills.js";
export * from "./panel.js";
export * from "./settings.js";
export * from "./skill-panel.js";
export { formatVimHotkeysMarkdown, formatVimKeys, installHotkeysPanel };

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
          {
            color: cfg.loadingIndicatorColor,
            fade: cfg.loadingIndicatorFade,
          },
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
  for (const entry of readBranchEntries(ctx.sessionManager) ?? []) {
    const typed = entry as {
      type?: unknown;
      message?: {
        role?: unknown;
        content?: Array<{
          type?: unknown;
          name?: unknown;
          arguments?: { code?: unknown };
        }>;
      };
    };
    if (typed.type !== "message") continue;
    const message = typed.message;
    if (message?.role !== "assistant" || !Array.isArray(message.content))
      continue;
    for (const block of message.content) {
      if (block.type !== "toolCall" || block.name !== "codemode") continue;
      const value = block.arguments?.code;
      if (typeof value === "string") code = value;
    }
  }
  return code;
}

export default function (pi: ExtensionAPI): void {
  installLoaderIndicatorPatch();
  let lastCodemodeCode: string | undefined;
  let lastToolCall:
    | { name: string; input: Record<string, unknown> }
    | undefined;
  let activeCtx: ExtensionContext | undefined;
  let releasePadding: (() => void) | undefined;
  let activeEditor: ModalEditor | undefined;
  const getTheme = () => activeCtx && hostUi(activeCtx)?.theme;
  installSkillPanel(getTheme);
  installBashPanel(getTheme);
  installBranchSummaryPanel(getTheme);
  installCompactionSummaryPanel(getTheme);
  installCustomMessagePanel(getTheme);
  installExtensionInputPanel(getTheme);
  installUserMessagePanel(
    getTheme,
    () => activeEditor?.getPromptChar() ?? getPromptChar(),
  );
  installHotkeysPanel(getTheme, () => loadModalConfig(getAgentDir()));
  let activeTui:
    | {
        requestRender?: (force?: boolean) => void;
      }
    | undefined;
  let shimmerAnimator: ThinkingShimmerAnimator | undefined;

  const applyWorkingIndicator = (ctx: ExtensionContext | undefined): void => {
    if (!ctx?.hasUI || typeof hostUi(ctx)?.setWorkingIndicator !== "function") {
      return;
    }
    const cfg = getActiveTuiConfig();
    loaderIndicatorTheme = hostUi(ctx).theme;
    hostUi(ctx).setWorkingIndicator(
      createWorkingIndicator(
        cfg.loadingIndicator,
        hostUi(ctx).theme,
        cfg.colored,
        {
          color: cfg.loadingIndicatorColor,
          fade: cfg.loadingIndicatorFade,
        },
      ),
    );
  };

  const publishModalSnapshot = (ctx: ExtensionContext | undefined): void => {
    if (!ctx?.sessionManager) return;
    const toolsExpanded =
      typeof hostUi(ctx)?.getToolsExpanded === "function"
        ? hostUi(ctx).getToolsExpanded()
        : undefined;
    updateSessionSnapshot(ctx.sessionManager, "modal", {
      ...(toolsExpanded !== undefined ? { toolsExpanded } : {}),
      ...(lastToolCall ? { lastTool: lastToolCall.name } : {}),
      hasLastCodemode: Boolean(
        lastCodemodeCode ?? lastCodemodeFromSession(ctx),
      ),
      updatedAt: Date.now(),
    });
  };

  pi.registerToolRenderer?.((toolName, next) => {
    const renderer = next();
    const base = toolName === "codemode" ? codemodePreview(renderer) : renderer;
    if (getActiveTuiConfig().panel.enabled) {
      const panel = wrapToolRenderer(
        toolName,
        base,
        () => panelRenderConfig(getActiveTuiConfig()),
        { requestRender: () => activeTui?.requestRender?.() },
      );
      return withToolOutputDisplay(toolName, panel, true);
    }
    const renderCall = base?.renderCall;
    return withToolOutputDisplay(
      toolName,
      toolName === "codemode" && renderCall
        ? {
            ...base,
            renderCall: (args, theme, context) =>
              renderCall(args, theme, { ...context, expanded: true }),
          }
        : base,
    );
  });

  const transformMarkdown: Parameters<
    ExtensionAPI["registerMarkdownTransformer"]
  >[0] = (markdown, context) => {
    const cfg = getActiveTuiConfig();
    if (context.messageType === "assistant-thinking") {
      const line = formatThinkingMarkdown(
        markdown,
        context.availableWidth,
        cfg,
      );
      const oneLine =
        cfg.thinkingVerbosity === "medium" ||
        cfg.thinkingVerbosity === "minimal";
      if (
        oneLine &&
        context.isStreaming &&
        cfg.thinkingAnimate &&
        cfg.colored
      ) {
        const stripped = stripMarkdownInline(line);
        if (typeof activeTui?.requestRender === "function") {
          shimmerAnimator ??= createThinkingShimmerAnimator(
            {
              requestRender: (force) => activeTui?.requestRender?.(force),
            },
            { speed: cfg.shimmerSpeed },
          );
          return shimmerAnimator.frame(
            stripped,
            hostUi(activeCtx)?.theme,
            true,
          );
        }
        shimmerAnimator?.dispose();
        shimmerAnimator = undefined;
        return renderThinkingShimmerFrame(
          stripped,
          Math.floor(Date.now() / getShimmerIntervalMs(cfg.shimmerSpeed)),
          hostUi(activeCtx)?.theme,
          true,
        );
      }
      shimmerAnimator?.dispose();
      shimmerAnimator = undefined;
      return line;
    }
    return cfg.markdownRender ? normalizeAgentMarkdown(markdown) : markdown;
  };
  if (typeof pi.registerMarkdownTransformer === "function") {
    installThinkingVisibility(transformMarkdown, getTheme);
    pi.registerMarkdownTransformer(transformMarkdown);
  }

  pi.events?.on?.("tui:config-changed", () => {
    activeEditor?.invalidate();
    activeTui?.requestRender?.(true);
  });

  const TUI_SUBCOMMANDS = ["settings", "status"] as const;
  pi.registerCommand("ui", {
    description:
      "Inspect or configure UI appearance, output, and tool settings",
    getArgumentCompletions: (prefix: string) =>
      prefixCompletions(prefix.trim(), TUI_SUBCOMMANDS),
    handler: async (args: string, ctx: ExtensionContext) => {
      activeCtx = ctx;
      const sub = args.trim().toLowerCase();
      if (sub === "status") {
        if (ctx.hasUI) {
          notify(
            ctx,
            `pi-modal TUI: ${formatTuiStatus(getActiveTuiConfig())}`,
            "info",
          );
        }
        return;
      }
      if (sub === "" || sub === "settings") {
        if (!canOverlay(ctx)) {
          if (ctx.hasUI) {
            notify(
              ctx,
              `pi-modal TUI: ${formatTuiStatus(getActiveTuiConfig())} (interactive settings require TUI mode)`,
              "info",
            );
          }
          return;
        }
        await showTuiSettings(ctx, getAgentDir(), (next) => {
          shimmerAnimator?.dispose();
          shimmerAnimator = undefined;
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
        notify(ctx, "Usage: /ui [settings|status]", "error");
      }
    },
  });
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
    publishModalSnapshot(ctx);
  };

  pi.on("input", (event, _ctx) => {
    const res = handleSkillInput(event, pi);
    if (
      (event as { streamingBehavior?: unknown }).streamingBehavior === "steer"
    ) {
      const targetText =
        res && res.action === "transform" ? res.text : event.text;
      const skillBlock = parseSkillBlock(targetText);
      markSteeredUserMessage(skillBlock?.userMessage ?? targetText);
    }
    return res;
  });

  pi.on("session_tree", (_event, ctx) => {
    syncFromBranch(ctx);
    if (ctx.hasUI) applyWorkingIndicator(ctx);
    // Reinstall the modal editor after branch navigation; the host may have
    // disposed the previous editor component when the session was replaced.
    if (ctx.hasUI && typeof hostUi(ctx).setEditorComponent === "function") {
      const config = loadModalConfig(getAgentDir(), (message) =>
        notify(ctx, `pi-modal: ${message}`, "warning"),
      );
      if (config.enabled !== false) {
        hostUi(ctx).setEditorComponent((tui, theme, kb) => {
          activeTui = tui as unknown as typeof activeTui;
          activeEditor = new ModalEditor(
            tui,
            theme,
            kb,
            config,
            undefined,
            hostUi(ctx).theme,
          );
          return activeEditor;
        });
      }
    }
  });

  pi.on("session_compact", (_event, ctx) => {
    publishModalSnapshot(ctx);
  });

  pi.on("session_shutdown", () => {
    releasePadding?.();
    releasePadding = undefined;
    shimmerAnimator?.dispose();
    shimmerAnimator = undefined;
  });

  pi.on("session_start", (_event, ctx) => {
    activeCtx = ctx;
    releasePadding?.();
    releasePadding =
      ctx.mode === "tui"
        ? bindHostOutputPadding(() =>
            pi.getSettings?.()?.outputPad === 0 ? 0 : 1,
          )
        : undefined;
    shimmerAnimator?.dispose();
    shimmerAnimator = undefined;
    syncFromBranch(ctx);
    loadAndActivateTuiConfig(getAgentDir(), (msg) =>
      notify(ctx, `pi-modal: ${msg}`, "warning"),
    );
    if (ctx.hasUI) applyWorkingIndicator(ctx);
    if (
      ctx.hasUI &&
      typeof hostUi(ctx).addAutocompleteProvider === "function"
    ) {
      registerSkillAutocomplete(pi, ctx);
    }
    if (!ctx.hasUI || typeof hostUi(ctx).setEditorComponent !== "function")
      return;
    const config = loadModalConfig(getAgentDir(), (message) =>
      notify(ctx, `pi-modal: ${message}`, "warning"),
    );
    if (config.enabled === false) return;
    hostUi(ctx).setEditorComponent((tui, theme, kb) => {
      activeTui = tui as unknown as typeof activeTui;
      activeEditor = new ModalEditor(
        tui,
        theme,
        kb,
        config,
        undefined,
        hostUi(ctx).theme,
        (rows) => {
          const ui = hostUi(activeCtx ?? ctx);
          if (typeof ui?.setWidget !== "function") return;
          const widgetTheme = ui.theme ?? (theme as never);
          ui.setWidget(
            "hollowheap.autocomplete",
            rows === undefined
              ? undefined
              : () => ({
                  render: (width: number) =>
                    boxFrame([...rows], width, widgetTheme, undefined, {
                      paddingX: 1,
                      marginX: 0,
                    }),
                  invalidate: () => {},
                }),
            { placement: "aboveEditor" },
          );
        },
      );
      return activeEditor;
    });
  });
}
