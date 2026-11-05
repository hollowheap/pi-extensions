import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { showCodeViewer } from "@hollowheap/tui/viewer";
import { ModalEditor } from "./editor.js";
import { loadModalConfig } from "./keymap.js";
import { formatVimKeys } from "./vimkeys.js";
import { crushWorkingIndicator } from "./working.js";

export { ModalEditor } from "./editor.js";
export * from "./keymap.js";

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

export default function (pi: ExtensionAPI): void {
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
      if (mode === "" || mode === "toggle") {
        ctx.ui.setToolsExpanded(!ctx.ui.getToolsExpanded());
      } else if (mode === "on" || mode === "expand") {
        ctx.ui.setToolsExpanded(true);
      } else if (mode === "off" || mode === "collapse") {
        ctx.ui.setToolsExpanded(false);
      } else {
        ctx.ui.notify("Usage: /expand [on|off|toggle]", "error");
        return;
      }
      ctx.ui.notify(
        `pi-modal: tool output ${ctx.ui.getToolsExpanded() ? "expanded" : "collapsed"}`,
      );
    },
  });

  let lastCodemodeCode: string | undefined;
  let lastToolCall:
    | { name: string; input: Record<string, unknown> }
    | undefined;

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
        `Last tool call (not codemode): ${lastToolCall.name}`,
        JSON.stringify(lastToolCall.input, null, 2),
      );
      return;
    }
    ctx.ui.notify("pi-modal: no codemode script yet", "info");
  };

  pi.on("tool_call", (event) => {
    if (event.parentToolCallId === undefined) {
      lastToolCall = {
        name: event.toolName,
        input: event.input as Record<string, unknown>,
      };
    }
    if (event.toolName !== "codemode") return;
    const code = event.input.code;
    if (typeof code === "string") lastCodemodeCode = code;
  });

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

  pi.on("session_start", (_event, ctx) => {
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
