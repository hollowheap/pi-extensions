import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { type WebSettings, loadWebConfig, saveWebSettings } from "./config.js";
import { showWebSettings } from "./settings.js";
import {
  createWebFetchTool,
  createWebSearchTool,
  getLastWebLinks,
} from "./tools.js";

export default function (pi: ExtensionAPI): void {
  pi.registerTool(createWebSearchTool());
  pi.registerTool(createWebFetchTool());
  pi.registerCommand("web", {
    description:
      "Web tools: /web settings; /web insert <n> inserts a recent result link",
    getArgumentCompletions: (prefix: string) => {
      const parts = prefix.trimStart().split(/\s+/);
      if (parts.length === 1) {
        return ["settings", "insert"]
          .filter((action) => action.startsWith((parts[0] ?? "").toLowerCase()))
          .map((action) => ({ value: action, label: action }));
      }
      if (parts[0] !== "insert" || parts.length > 2) return null;
      const query = (parts[1] ?? "").toLowerCase();
      return getLastWebLinks()
        .map((url, index) => ({
          value: String(index + 1),
          label: String(index + 1),
          description: url,
        }))
        .filter(
          (item) =>
            item.value.startsWith(query) ||
            item.description.toLowerCase().includes(query),
        );
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts[0] === "insert") {
        const links = getLastWebLinks();
        if (links.length === 0) {
          if (ctx.hasUI) {
            ctx.ui.notify("No recent web results to insert.", "info");
          }
          return;
        }
        const index =
          parts[1] === undefined ? undefined : Number.parseInt(parts[1], 10);
        if (index === undefined) {
          if (ctx.hasUI) {
            ctx.ui.notify(
              links.map((url, i) => `${i + 1}. ${url}`).join("\n"),
              "info",
            );
          }
          return;
        }
        const url = links[index - 1];
        if (!Number.isInteger(index) || url === undefined) {
          if (ctx.hasUI) {
            ctx.ui.notify(`Usage: /web insert <1-${links.length}>`, "error");
          }
          return;
        }
        if (typeof ctx.ui.pasteToEditor !== "function") {
          if (ctx.hasUI) {
            ctx.ui.notify("Editor insertion is unavailable.", "error");
          }
          return;
        }
        ctx.ui.pasteToEditor(url);
        if (ctx.hasUI) {
          ctx.ui.notify(`Inserted ${url}`, "info");
        }
        return;
      }
      if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `Web settings require TUI mode; edit ${loadWebConfig(getAgentDir()).path}`,
            "info",
          );
        }
        return;
      }
      const config = loadWebConfig(getAgentDir());
      for (const diagnostic of config.diagnostics) {
        ctx.ui.notify(`pi-web: ${diagnostic}`, "warning");
      }
      let saved = false;
      await showWebSettings(ctx, config, (settings: WebSettings) => {
        try {
          saveWebSettings(getAgentDir(), settings);
          saved = true;
        } catch (error) {
          ctx.ui.notify(
            `pi-web: failed to save settings: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
        }
      });
      if (saved) ctx.ui.notify("Web settings saved", "info");
    },
  });
}
