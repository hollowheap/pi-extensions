import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { errorMessage } from "@hollowheap/core/format";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { appendSessionEntry, readBranchEntries } from "@hollowheap/core/state";
import { hostUi, notify } from "@hollowheap/pi-ui/host";
import { runSettingsCommand } from "@hollowheap/pi-ui/settings";
import { prefixCompletions } from "@hollowheap/tui/autocomplete";
import {
  type WebSettings,
  loadWebConfig,
  saveWebSettings,
  showWebSettings,
} from "./settings.js";
import {
  WEB_HISTORY_TYPE,
  createWebFetchTool,
  createWebSearchTool,
  getLastWebLinks,
  getWebSessionState,
} from "./tools.js";

export default function (pi: ExtensionAPI): void {
  pi.registerTool(createWebSearchTool({}, pi));
  pi.registerTool(createWebFetchTool({}, pi));

  let lastCtx: ExtensionContext | undefined;

  const restoreWebSession = (ctx?: ExtensionContext) => {
    if (!ctx) return;
    lastCtx = ctx;
    const entries = readBranchEntries(ctx.sessionManager) ?? [];
    let lastData:
      | {
          urls?: string[];
          searchCount?: number;
          fetchCount?: number;
          updatedAt?: number;
        }
      | undefined;
    for (const entry of entries) {
      const raw = entry as {
        type?: string;
        customType?: string;
        data?: unknown;
      };
      if (
        (raw.type === "custom" && raw.customType === WEB_HISTORY_TYPE) ||
        raw.type === WEB_HISTORY_TYPE
      ) {
        if (typeof raw.data === "object" && raw.data !== null) {
          lastData = raw.data as typeof lastData;
        }
      }
    }
    const state = getWebSessionState(ctx.sessionManager);
    if (lastData) {
      state.urls = Array.isArray(lastData.urls) ? lastData.urls : [];
      state.searchCount =
        typeof lastData.searchCount === "number" ? lastData.searchCount : 0;
      state.fetchCount =
        typeof lastData.fetchCount === "number" ? lastData.fetchCount : 0;
      state.updatedAt =
        typeof lastData.updatedAt === "number"
          ? lastData.updatedAt
          : Date.now();
    }
    if (ctx.sessionManager) {
      updateSessionSnapshot(ctx.sessionManager, "web", {
        searchCount: state.searchCount,
        fetchCount: state.fetchCount,
        recentUrls: state.urls,
        updatedAt: state.updatedAt,
      });
    }
  };

  pi.on("session_start", (_event, ctx) => {
    restoreWebSession(ctx);
    const active = pi.getActiveTools();
    const next = active.filter(
      (name) => name !== "web_search" && name !== "web_fetch",
    );
    if (pi.getAllTools().some((tool) => tool.name === "codemode")) {
      if (!next.includes("codemode")) next.push("codemode");
    }
    if (
      next.length !== active.length ||
      next.some((name, index) => name !== active[index])
    ) {
      pi.setActiveTools(next);
    }
  });

  pi.on("session_tree", (_event, ctx) => {
    restoreWebSession(ctx);
  });

  pi.on("session_compact", (_event, ctx) => {
    const owner = ctx?.sessionManager ?? lastCtx?.sessionManager;
    const state = getWebSessionState(owner);
    if (
      state.urls.length > 0 ||
      state.searchCount > 0 ||
      state.fetchCount > 0
    ) {
      appendSessionEntry(pi, owner, WEB_HISTORY_TYPE, {
        urls: state.urls,
        searchCount: state.searchCount,
        fetchCount: state.fetchCount,
        updatedAt: Date.now(),
      });
    }
  });
  pi.registerCommand("web", {
    description:
      "Web tools: /web settings|config; /web insert <n> inserts a recent result link",
    getArgumentCompletions: (prefix: string) => {
      const parts = prefix.trimStart().split(/\s+/);
      if (parts.length === 1) {
        return prefixCompletions(parts[0] ?? "", [
          "settings",
          "config",
          "insert",
        ]);
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
      const subcommand = (parts[0] ?? "").toLowerCase();
      if (subcommand === "insert") {
        const links = getLastWebLinks(ctx?.sessionManager);
        if (links.length === 0) {
          if (ctx.hasUI) {
            notify(ctx, "No recent web results to insert.", "info");
          }
          return;
        }
        const index =
          parts[1] === undefined ? undefined : Number.parseInt(parts[1], 10);
        if (index === undefined) {
          if (ctx.hasUI) {
            notify(
              ctx,
              links.map((url, i) => `${i + 1}. ${url}`).join("\n"),
              "info",
            );
          }
          return;
        }
        const url = links[index - 1];
        if (!Number.isInteger(index) || url === undefined) {
          if (ctx.hasUI) {
            notify(ctx, `Usage: /web insert <1-${links.length}>`, "error");
          }
          return;
        }
        if (typeof hostUi(ctx).pasteToEditor !== "function") {
          if (ctx.hasUI) {
            notify(ctx, "Editor insertion is unavailable.", "error");
          }
          return;
        }
        hostUi(ctx).pasteToEditor(url);
        if (ctx.hasUI) {
          notify(ctx, `Inserted ${url}`, "info");
        }
        return;
      }
      if (
        subcommand !== "" &&
        subcommand !== "settings" &&
        subcommand !== "config"
      ) {
        if (ctx.hasUI) {
          notify(
            ctx,
            "Usage: /web [settings|config] or /web insert <n>",
            "info",
          );
        }
        return;
      }
      const config = loadWebConfig(getAgentDir());
      await runSettingsCommand(ctx, {
        prefix: "pi-web",
        title: "Web settings",
        configPath: config.path,
        diagnostics: config.diagnostics,
        savedMessage: "Web settings saved",
        open: async () => {
          let saved = false;
          await showWebSettings(ctx, config, (settings: WebSettings) => {
            try {
              saveWebSettings(getAgentDir(), settings);
              saved = true;
            } catch (error) {
              saved = false;
              if (ctx.hasUI) {
                notify(
                  ctx,
                  `pi-web: failed to save settings: ${errorMessage(error)}`,
                  "error",
                );
              }
            }
          });
          return saved;
        },
      });
    },
  });
}
