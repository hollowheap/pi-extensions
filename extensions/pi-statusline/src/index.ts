import { homedir } from "node:os";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { messageCost } from "@hollowheap/core/pricing";
import { effectiveCwd } from "@hollowheap/core/state";
import { alertAgentCompletion } from "./alerts.js";
import {
  BUILTINS,
  type GitDiffState,
  type TokenTotals,
  clockIntervalMs,
  createGitDiffState,
  defaultGitRunner,
} from "./components.js";
import {
  type StatuslineConfig,
  defaultConfig,
  loadConfig,
  saveOptions,
} from "./config.js";
import { renderStatusline } from "./render.js";
import { showStatuslineSettings } from "./settings.js";
import { showThemePicker } from "./theme-picker.js";

const DEFAULT_CLICK_ACTIONS: Record<string, string> = {
  mode: "/mode",
  model: "/model",
  usage: "/usage",
};

function sumTokens(ctx: ExtensionContext, model?: unknown): TokenTotals {
  const totals: TokenTotals = { input: 0, output: 0, cost: 0 };
  let customUsageCost: number | undefined;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (
      entry.type === "custom" &&
      (entry as { customType?: string }).customType === "hollowheap.usage"
    ) {
      const data = (entry as { data?: { totalCost?: unknown } }).data;
      if (
        typeof data?.totalCost === "number" &&
        !Number.isNaN(data.totalCost)
      ) {
        customUsageCost = data.totalCost;
      }
    }
    if (entry.type !== "message") continue;
    const message = entry.message as AssistantMessage;
    if (message.role !== "assistant") continue;
    totals.input += message.usage?.input ?? 0;
    totals.output += message.usage?.output ?? 0;
    totals.cost += messageCost(message as never, model ?? ctx.model);
  }

  if (
    totals.cost === 0 &&
    customUsageCost !== undefined &&
    customUsageCost > 0
  ) {
    totals.cost = customUsageCost;
  }

  return totals;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default function (pi: ExtensionAPI) {
  let config: StatuslineConfig = defaultConfig();
  let busy = false;
  let currentModel: unknown;
  let repoRoot: string | undefined;
  let diffState: GitDiffState = createGitDiffState(defaultGitRunner, () => {});
  let requestRender: (() => void) | undefined;
  let cleanupFooter: (() => void) | undefined;
  let owner: ExtensionContext["sessionManager"] | undefined;
  const values = new Map<string, string>();
  pi.events.on("statusline:values", (data) => {
    if (!isRecord(data)) return;
    const { name, text } = data;
    if (typeof name !== "string" || typeof text !== "string") return;
    if (values.get(name) === text) return;
    values.set(name, text);
    requestRender?.();
  });

  function neededNames(): string[] {
    const names = new Set<string>();
    for (const specs of Object.values(config.sections)) {
      for (const spec of specs) {
        if (!(spec.type in BUILTINS) && config.extensions.includes(spec.type)) {
          names.add(spec.type);
        }
      }
    }
    return [...names];
  }

  async function refreshRepoRoot(ctx: ExtensionContext): Promise<void> {
    const session = ctx.sessionManager;
    const cwd = effectiveCwd(ctx.cwd, session);
    try {
      const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
        cwd,
      });
      if (session !== owner) return;
      repoRoot =
        result.code === 0 && result.stdout.trim() !== ""
          ? result.stdout.trim()
          : undefined;
    } catch {
      if (session !== owner) return;
      repoRoot = undefined;
    }
    requestRender?.();
  }

  function disposeFooter(): void {
    cleanupFooter?.();
    cleanupFooter = undefined;
    requestRender = undefined;
    diffState.clear();
  }

  function installFooter(ctx: ExtensionContext): void {
    disposeFooter();
    owner = ctx.sessionManager;
    repoRoot = undefined;
    if (ctx.mode !== "tui") return;
    void refreshRepoRoot(ctx);
    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      diffState = createGitDiffState(defaultGitRunner, () => requestRender?.());
      const branchUnsubscribe = footerData.onBranchChange(() => {
        diffState.refresh(ctx.cwd);
        tui.requestRender();
      });
      const clockMs = clockIntervalMs(config.sections);
      const clockTimer =
        clockMs === undefined
          ? undefined
          : setInterval(() => tui.requestRender(), clockMs);
      diffState.refresh(ctx.cwd);
      pi.events.emit("statusline:request", { names: neededNames() });
      let disposed = false;
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        branchUnsubscribe();
        if (clockTimer !== undefined) clearInterval(clockTimer);
      };
      cleanupFooter = cleanup;
      return {
        dispose: cleanup,
        invalidate() {},
        render(width: number): string[] {
          const line = renderStatusline(
            width,
            config,
            {
              cwd: effectiveCwd(ctx.cwd, ctx.sessionManager),
              homeDir: homedir(),
              repoRoot,
              modelId: (currentModel as { id?: string })?.id ?? ctx.model?.id,
              branch: footerData.getGitBranch(),
              tokens: sumTokens(ctx, currentModel),
              contextPercent: ctx.getContextUsage()?.percent ?? null,
              busy,
              thinkingLevel: ctx.thinkingLevel,
              now: new Date(),
              gitDiff: diffState.get(ctx.cwd),
            },
            theme,
            values,
          );
          return line === "" ? [] : [line];
        },
      };
    });
    requestRender?.();
  }

  pi.on("session_start", (_event, ctx) => {
    const loaded = loadConfig(getAgentDir());
    config = loaded.config;
    values.clear();
    busy = false;
    currentModel = ctx.model;
    if (loaded.diagnostics.length > 0) {
      ctx.ui.notify(
        `pi-statusline: ${loaded.diagnostics.slice(0, 3).join("; ")}`,
        "warning",
      );
    }
    installFooter(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    installFooter(ctx);
    requestRender?.();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.sessionManager !== owner) return;
    owner = undefined;
    disposeFooter();
    ctx.ui.setFooter(undefined);
  });

  pi.on("agent_start", (_event, ctx) => {
    if (ctx.sessionManager !== owner) return;
    busy = true;
    requestRender?.();
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (ctx.sessionManager !== owner) return;
    if (busy) alertAgentCompletion();
    busy = false;
    requestRender?.();
  });

  pi.on("turn_end", (_event, ctx) => {
    if (ctx.sessionManager !== owner) return;
    diffState.refresh(ctx.cwd);
    void refreshRepoRoot(ctx);
    requestRender?.();
  });

  pi.on("tool_execution_end", (_event, ctx) => {
    if (ctx.sessionManager !== owner) return;
    diffState.refresh(ctx.cwd);
    void refreshRepoRoot(ctx);
    requestRender?.();
  });

  pi.on("model_select", (event, ctx) => {
    if (ctx.sessionManager !== owner) return;
    currentModel = (event as { model?: unknown })?.model;
    requestRender?.();
  });

  pi.registerCommand("theme", {
    description: "Select the interactive color theme",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
        if (ctx.hasUI) {
          ctx.ui.notify("Theme selection requires TUI mode.", "info");
        }
        return;
      }
      const picked = await showThemePicker(ctx);
      if (picked !== undefined && ctx.hasUI) {
        ctx.ui.notify(`Theme: ${picked}`, "info");
      }
    },
  });

  pi.registerCommand("statusline", {
    description: "Statusline actions: click, settings, working, or thinking",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts[0] === "working") {
        if (typeof ctx.ui.setWorkingIndicator !== "function") {
          if (ctx.hasUI) {
            ctx.ui.notify(
              "Working indicator customization is unavailable.",
              "info",
            );
          }
          return;
        }
        const preset = parts[1] ?? "default";
        if (preset === "default") ctx.ui.setWorkingIndicator();
        else if (preset === "pulse")
          ctx.ui.setWorkingIndicator({ frames: ["●", "○"], intervalMs: 400 });
        else if (preset === "compact")
          ctx.ui.setWorkingIndicator({
            frames: ["⠋", "⠙", "⠹", "⠸"],
            intervalMs: 100,
          });
        else if (preset === "hidden")
          ctx.ui.setWorkingIndicator({ frames: [] });
        else {
          if (ctx.hasUI) {
            ctx.ui.notify(
              "Usage: /statusline working default|pulse|compact|hidden",
              "error",
            );
          }
          return;
        }
        if (ctx.hasUI) ctx.ui.notify(`Working indicator: ${preset}`, "info");
        return;
      }
      if (parts[0] === "thinking") {
        if (typeof ctx.ui.setHiddenThinkingLabel !== "function") {
          if (ctx.hasUI) {
            ctx.ui.notify(
              "Thinking label customization is unavailable.",
              "info",
            );
          }
          return;
        }
        const label = parts.slice(1).join(" ").trim();
        if (label === "" || label === "default") {
          ctx.ui.setHiddenThinkingLabel();
          if (ctx.hasUI) ctx.ui.notify("Thinking label: default", "info");
        } else {
          ctx.ui.setHiddenThinkingLabel(label);
          if (ctx.hasUI) ctx.ui.notify(`Thinking label: ${label}`, "info");
        }
        return;
      }
      if (parts[0] === "settings") {
        if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
          if (ctx.hasUI)
            ctx.ui.notify(
              "Statusline settings require TUI mode; edit statusline.json instead.",
              "info",
            );
          return;
        }
        await showStatuslineSettings(ctx, config, (next) => {
          config = next;
          try {
            saveOptions(getAgentDir(), next.options);
          } catch (error) {
            if (ctx.hasUI) {
              ctx.ui.notify(
                `pi-statusline: failed to save settings: ${error instanceof Error ? error.message : String(error)}`,
                "error",
              );
            }
          }
          requestRender?.();
        });
        return;
      }
      if (parts[0] === "click" && parts[1]) {
        const segment = parts[1];
        const action =
          config.clickActions?.[segment] ?? DEFAULT_CLICK_ACTIONS[segment];
        if (action) {
          if (action.startsWith("/")) {
            pi.sendUserMessage(action, { expandPromptTemplates: true });
            if (ctx.hasUI) ctx.ui.notify(`Running: ${action}`, "info");
            return;
          }
          const [command, ...actionArgs] = action.trim().split(/\s+/);
          if (!command) return;
          if (ctx.hasUI) ctx.ui.notify(`Running: ${action}`, "info");
          try {
            const result = await pi.exec(command, actionArgs);
            if (!ctx.hasUI) return;
            const output = (result.stdout || result.stderr).trim();
            if (output) {
              ctx.ui.notify(output, result.code === 0 ? "info" : "error");
            }
            if (result.code !== 0) {
              ctx.ui.notify(
                `pi-statusline: action exited with code ${result.code}`,
                "error",
              );
            }
          } catch (error) {
            if (ctx.hasUI) {
              ctx.ui.notify(
                `pi-statusline: ${error instanceof Error ? error.message : String(error)}`,
                "error",
              );
            }
          }
        } else {
          if (ctx.hasUI)
            ctx.ui.notify(`No click action for ${segment}`, "info");
        }
        return;
      }
      if (ctx.hasUI) {
        ctx.ui.notify(
          "Usage: /statusline click <segment> | /statusline settings",
          "info",
        );
      }
    },
  });
}
