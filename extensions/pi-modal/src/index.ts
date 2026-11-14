import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { showCodeViewer } from "@hollowheap/tui/viewer";
import { ModalEditor } from "./editor.js";
import { loadModalConfig } from "./keymap.js";
import { handleSkillInput, registerSkillAutocomplete } from "./skills.js";
import { formatVimKeys } from "./vimkeys.js";
import { crushWorkingIndicator } from "./working.js";

export { ModalEditor } from "./editor.js";
export * from "./keymap.js";
export * from "./skills.js";

function lastCodemodeFromSession(ctx: ExtensionContext): string | undefined {
  let code: string | undefined;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type !== "toolCall" || block.name !== "codemode") continue;
      const value = block.arguments.code;
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
  let lastCodemodeCode: string | undefined;
  let lastToolCall:
    | { name: string; input: Record<string, unknown> }
    | undefined;
  let persistedExpand: boolean | undefined;

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
    const renderCall = base?.renderCall;
    if (toolName !== "codemode" || renderCall === undefined) return base;
    return {
      ...base,
      renderCall(args, theme, context) {
        return renderCall(args, theme, { ...context, expanded: true });
      },
    };
  });

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
      await showCodeViewer(ctx, "Last codemode script", code);
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
  });

  pi.on("session_compact", (_event, ctx) => {
    if (persistedExpand !== undefined) {
      pi.appendEntry(MODAL_EXPAND_TYPE, { expanded: persistedExpand });
    }
    publishModalSnapshot(ctx);
  });

  pi.on("session_start", (_event, ctx) => {
    syncFromBranch(ctx);
    if (ctx.hasUI && typeof ctx.ui.addAutocompleteProvider === "function") {
      registerSkillAutocomplete(pi, ctx);
    }
    if (!ctx.hasUI || typeof ctx.ui.setEditorComponent !== "function") return;
    const config = loadModalConfig(getAgentDir(), (message) =>
      ctx.ui.notify(`pi-modal: ${message}`, "warning"),
    );
    if (config.enabled === false) return;
    ctx.ui.setWorkingIndicator(crushWorkingIndicator(ctx.ui.theme));
    ctx.ui.setEditorComponent(
      (tui, theme, kb) =>
        new ModalEditor(tui, theme, kb, config, undefined, ctx.ui.theme),
    );
  });
}
