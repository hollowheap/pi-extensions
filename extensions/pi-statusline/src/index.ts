import { homedir } from "node:os";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  calculateDollarCost,
  effectiveCwd,
  resolveModelPricing,
} from "@hollowheap/core";
import {
  BUILTINS,
  type GitDiffCache,
  type TokenTotals,
  clockIntervalMs,
  createGitDiffCache,
  defaultGitRunner,
} from "./components.js";
import { type StatuslineConfig, defaultConfig, loadConfig } from "./config.js";
import { renderStatusline } from "./render.js";

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
    totals.cost += message.usage?.cost?.total ?? 0;
  }

  if (
    totals.cost === 0 &&
    customUsageCost !== undefined &&
    customUsageCost > 0
  ) {
    totals.cost = customUsageCost;
  }

  if (totals.cost === 0 && (totals.input > 0 || totals.output > 0)) {
    const pricing = resolveModelPricing(model ?? ctx.model);
    if (pricing) {
      totals.cost = calculateDollarCost(
        { input: totals.input, output: totals.output },
        pricing,
      );
    }
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
  let diffCache: GitDiffCache = createGitDiffCache(
    defaultGitRunner,
    () => {},
    5000,
  );
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

  function disposeFooter(): void {
    cleanupFooter?.();
    cleanupFooter = undefined;
    requestRender = undefined;
  }

  function installFooter(ctx: ExtensionContext): void {
    disposeFooter();
    owner = ctx.sessionManager;
    if (ctx.mode !== "tui") return;
    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      diffCache = createGitDiffCache(
        defaultGitRunner,
        () => requestRender?.(),
        config.options.gitIntervalMs,
      );
      const branchUnsubscribe = footerData.onBranchChange(() => {
        diffCache.refresh(ctx.cwd);
        tui.requestRender();
      });
      const clockMs = clockIntervalMs(config.sections);
      const clockTimer =
        clockMs === undefined
          ? undefined
          : setInterval(() => tui.requestRender(), clockMs);
      diffCache.refresh(ctx.cwd);
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
              modelId: (currentModel as { id?: string })?.id ?? ctx.model?.id,
              branch: footerData.getGitBranch(),
              tokens: sumTokens(ctx, currentModel),
              contextPercent: ctx.getContextUsage()?.percent ?? null,
              busy,
              thinkingLevel: ctx.thinkingLevel,
              now: new Date(),
              gitDiff: diffCache.get(ctx.cwd),
            },
            theme,
            values,
          );
          return line === "" ? [] : [line];
        },
      };
    });
  }

  pi.on("session_start", (_event, ctx) => {
    const loaded = loadConfig(getAgentDir());
    config = loaded.config;
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
    busy = false;
    requestRender?.();
  });

  pi.on("turn_end", (_event, ctx) => {
    if (ctx.sessionManager !== owner) return;
    diffCache.refresh(ctx.cwd);
    requestRender?.();
  });

  pi.on("tool_execution_end", (_event, ctx) => {
    if (ctx.sessionManager !== owner) return;
    diffCache.refresh(ctx.cwd);
    requestRender?.();
  });

  pi.on("model_select", (event) => {
    currentModel = (event as { model?: unknown })?.model;
    requestRender?.();
  });

  pi.registerCommand("statusline", {
    description: "Statusline actions: /statusline click <segment>",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\\s+/).filter(Boolean);
      if (parts[0] === "click" && parts[1]) {
        const segment = parts[1];
        const action = config.clickActions?.[segment];
        if (action) {
          if (ctx.hasUI) ctx.ui.notify(`Running: ${action}`, "info");
        } else {
          if (ctx.hasUI)
            ctx.ui.notify(`No click action for ${segment}`, "info");
        }
        return;
      }
      if (ctx.hasUI) {
        ctx.ui.notify("Usage: /statusline click <segment>", "info");
      }
    },
  });
}
