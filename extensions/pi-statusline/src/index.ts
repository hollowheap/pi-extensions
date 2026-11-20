import { homedir } from "node:os";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { buildAlertPayload, deliverAlert } from "@hollowheap/core/alerts";
import { errorMessage, sanitizeTerminalText } from "@hollowheap/core/format";
import { messageCost } from "@hollowheap/core/pricing";
import { isRecord } from "@hollowheap/core/records";
import { effectiveCwd, readBranchEntries } from "@hollowheap/core/state";
import {
  type StatuslineComponentSpec,
  type StatuslineContext,
  clearStatuslineEventValues,
  createScriptStatuslineProvider,
  getStatuslineProvider,
  registerStatuslineProvider,
  setStatuslineEventValue,
  statuslineEventValues,
} from "@hollowheap/core/statusline";
import { extractLatestUsage } from "@hollowheap/core/usage";
import { canOverlay, hostUi, notify } from "@hollowheap/pi-ui/host";
import { prefixCompletions } from "@hollowheap/ui/autocomplete";
import {
  type GitDiffState,
  type TokenTotals,
  createGitDiffState,
  defaultGitRunner,
  findGitRoot,
} from "./components.js";
import { renderStatusline } from "./render.js";
import {
  type StatuslineConfig,
  defaultConfig,
  loadConfig,
  normalizeConfig,
  saveOptions,
  showStatuslineSettings,
} from "./settings.js";

const DEFAULT_CLICK_ACTIONS: Record<string, string> = {
  mode: "/mode",
  model: "/model",
  usage: "/usage",
  "usage-pct": "/usage",
  agent: "/agent",
  tasks: "/task",
  subagents: "/subagent",
};

type Branch = ReturnType<ExtensionContext["sessionManager"]["getBranch"]>;

function budgetPercent(branch: Branch): number | undefined {
  const usage = extractLatestUsage(branch);
  if (usage.budgetCap === undefined) return undefined;
  let spent = usage.totalCost;
  for (const subagent of usage.subagents ?? []) {
    if (subagent.available) spent += subagent.cost;
  }
  const percent = Math.round((spent / usage.budgetCap) * 100);
  return Number.isFinite(percent) ? percent : undefined;
}

function sumTokens(branch: Branch, model: unknown): TokenTotals {
  const totals: TokenTotals = { input: 0, output: 0, cost: 0 };
  let customUsageCost: number | undefined;

  for (const entry of branch) {
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
    totals.cost += messageCost(message as never, model);
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

export default function (pi: ExtensionAPI) {
  let config: StatuslineConfig = defaultConfig();
  let busy = false;
  let showsBudgetPercent = false;
  let currentModel: unknown;
  let repoRoot: string | null | undefined;
  let diffState: GitDiffState = createGitDiffState(defaultGitRunner, () => {});
  let requestRender: (() => void) | undefined;
  let cleanupFooter: (() => void) | undefined;
  let unsubscribeConfigChanged: (() => void) | undefined;
  let owner: ExtensionContext["sessionManager"] | undefined;
  let currentGitBranch: string | null = null;
  let branchTotalsCache:
    | {
        sessionManager: ExtensionContext["sessionManager"];
        length: number;
        lastEntry: unknown;
        model: unknown;
        showsBudgetPercent: boolean;
        tokens: TokenTotals;
        budgetPercent: number | undefined;
      }
    | undefined;
  const reportedDiagnosticTypes = new Set<string>();

  registerStatuslineProvider(
    createScriptStatuslineProvider((command, args, options) =>
      pi.exec(command, [...args], options),
    ),
  );

  pi.events.on("statusline:values", (data) => {
    if (!isRecord(data)) return;
    const { name, text } = data;
    if (typeof name !== "string" || typeof text !== "string") return;
    if (
      statuslineEventValues().get(name) === text &&
      !(showsBudgetPercent && name === "usage")
    )
      return;
    setStatuslineEventValue(name, text);
    requestRender?.();
  });

  pi.events.on("tui:config-changed", () => {
    requestRender?.();
  });

  function configuredSpecs(): StatuslineComponentSpec[] {
    const seen = new Set<string>();
    const specs: StatuslineComponentSpec[] = [];
    for (const section of Object.values(config.sections)) {
      for (const spec of section) {
        const key = JSON.stringify(spec);
        if (seen.has(key)) continue;
        seen.add(key);
        specs.push(spec);
      }
    }
    return specs;
  }

  function legacyNames(): string[] {
    const names = new Set<string>();
    for (const spec of configuredSpecs()) {
      if (getStatuslineProvider(spec.type) === undefined) names.add(spec.type);
    }
    return [...names];
  }

  function minimumIntervalMs(): number | undefined {
    let interval: number | undefined;
    for (const spec of configuredSpecs()) {
      const next = getStatuslineProvider(spec.type)?.intervalMs?.(spec);
      if (next === undefined) continue;
      interval = interval === undefined ? next : Math.min(interval, next);
    }
    return interval;
  }

  function contextFor(ctx: ExtensionContext): StatuslineContext {
    const branch = (readBranchEntries(ctx.sessionManager) ?? []) as Branch;
    const model = currentModel ?? ctx.model;
    const lastEntry = branch.length > 0 ? branch[branch.length - 1] : undefined;
    if (
      branchTotalsCache === undefined ||
      branchTotalsCache.sessionManager !== ctx.sessionManager ||
      branchTotalsCache.length !== branch.length ||
      branchTotalsCache.lastEntry !== lastEntry ||
      branchTotalsCache.model !== model ||
      branchTotalsCache.showsBudgetPercent !== showsBudgetPercent
    ) {
      branchTotalsCache = {
        sessionManager: ctx.sessionManager,
        length: branch.length,
        lastEntry,
        model,
        showsBudgetPercent,
        tokens: sumTokens(branch, model),
        budgetPercent: showsBudgetPercent ? budgetPercent(branch) : undefined,
      };
    }
    return {
      cwd: effectiveCwd(ctx.cwd, ctx.sessionManager),
      homeDir: homedir(),
      repoRoot,
      modelId: (currentModel as { id?: string })?.id ?? ctx.model?.id,
      branch: currentGitBranch,
      tokens: branchTotalsCache.tokens,
      contextPercent: ctx.getContextUsage()?.percent ?? null,
      budgetPercent: branchTotalsCache.budgetPercent,
      busy,
      thinkingLevel: ctx.thinkingLevel,
      now: new Date(),
      gitDiff: diffState.get(ctx.cwd),
    };
  }

  async function refreshProviders(ctx: ExtensionContext): Promise<void> {
    const snapshot = contextFor(ctx);
    await Promise.all(
      configuredSpecs().map(async (spec) => {
        const refresh = getStatuslineProvider(spec.type)?.refresh;
        if (refresh === undefined) return;
        try {
          await refresh(spec, snapshot);
        } catch {
          return;
        }
      }),
    );
    if (ctx.sessionManager === owner) requestRender?.();
  }

  async function refreshRepoRoot(ctx: ExtensionContext): Promise<void> {
    const session = ctx.sessionManager;
    const cwd = effectiveCwd(ctx.cwd, session);
    try {
      const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
        cwd,
      });
      if (session !== owner) return;
      if (result.code === 0 && result.stdout.trim() !== "") {
        repoRoot = result.stdout.trim();
      } else {
        repoRoot = findGitRoot(cwd) ?? null;
      }
    } catch {
      if (session !== owner) return;
      repoRoot = findGitRoot(cwd) ?? null;
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
    repoRoot = findGitRoot(effectiveCwd(ctx.cwd, ctx.sessionManager)) ?? null;
    if (ctx.mode !== "tui") return;
    void refreshRepoRoot(ctx);
    hostUi(ctx).setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      currentGitBranch = footerData.getGitBranch();
      diffState = createGitDiffState(defaultGitRunner, () => requestRender?.());
      const branchUnsubscribe = footerData.onBranchChange(() => {
        diffState.refresh(ctx.cwd);
        tui.requestRender();
      });
      const intervalMs = minimumIntervalMs();
      const renderTimer =
        intervalMs === undefined
          ? undefined
          : setInterval(() => {
              void refreshProviders(ctx);
              tui.requestRender();
            }, intervalMs);
      diffState.refresh(ctx.cwd);
      pi.events.emit("statusline:request", { names: legacyNames() });
      void refreshProviders(ctx);
      let disposed = false;
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        branchUnsubscribe();
        if (renderTimer !== undefined) clearInterval(renderTimer);
      };
      cleanupFooter = cleanup;
      return {
        dispose: cleanup,
        invalidate() {},
        render(width: number): string[] {
          currentGitBranch = footerData.getGitBranch();
          const line = renderStatusline(
            width,
            config,
            contextFor(ctx),
            theme,
            statuslineEventValues(),
            (message) => {
              const type = /component "([^"]+)"/.exec(message)?.[1] ?? message;
              if (reportedDiagnosticTypes.has(type)) return;
              reportedDiagnosticTypes.add(type);
              notify(ctx, `pi-statusline: ${message}`, "warning");
            },
          );
          return line === "" ? [] : [line];
        },
      };
    });
    requestRender?.();
  }

  function applyConfig(next: StatuslineConfig): void {
    config = next;
    showsBudgetPercent = Object.values(config.sections).some((specs) =>
      specs.some((spec) => spec.type === "usage-pct"),
    );
  }

  pi.on("session_start", (_event, ctx) => {
    clearStatuslineEventValues();
    const loaded = loadConfig(getAgentDir());
    applyConfig(loaded.config);
    busy = false;
    currentModel = ctx.model;
    if (loaded.diagnostics.length > 0) {
      notify(
        ctx,
        `pi-statusline: ${loaded.diagnostics.slice(0, 3).join("; ")}`,
        "warning",
      );
    }
    if (typeof unsubscribeConfigChanged === "function") {
      unsubscribeConfigChanged();
    }
    unsubscribeConfigChanged = pi.events?.on(
      "statusline:config-changed",
      (data) => {
        const next =
          data !== undefined
            ? normalizeConfig(data).config
            : loadConfig(getAgentDir()).config;
        applyConfig(next);
        requestRender?.();
      },
    );
    installFooter(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    installFooter(ctx);
    requestRender?.();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.sessionManager !== owner) return;
    owner = undefined;
    branchTotalsCache = undefined;
    if (typeof unsubscribeConfigChanged === "function") {
      unsubscribeConfigChanged();
    }
    unsubscribeConfigChanged = undefined;
    disposeFooter();
    clearStatuslineEventValues();
    hostUi(ctx).setFooter(undefined);
  });

  pi.on("agent_start", (_event, ctx) => {
    if (ctx.sessionManager !== owner) return;
    busy = true;
    requestRender?.();
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (ctx.sessionManager !== owner) return;
    if (busy) {
      void deliverAlert(
        buildAlertPayload("completion", undefined, "settled"),
      ).catch(() => {
        // Notification failures do not interrupt footer updates.
      });
    }
    busy = false;
    requestRender?.();
  });

  pi.on("turn_end", (_event, ctx) => {
    if (ctx.sessionManager !== owner) return;
    diffState.refresh(ctx.cwd);
    void refreshRepoRoot(ctx);
    void refreshProviders(ctx);
    requestRender?.();
  });

  pi.on("tool_execution_end", (_event, ctx) => {
    if (ctx.sessionManager !== owner) return;
    diffState.refresh(ctx.cwd);
    void refreshRepoRoot(ctx);
    void refreshProviders(ctx);
    requestRender?.();
  });

  pi.on("model_select", (event, ctx) => {
    if (ctx.sessionManager !== owner) return;
    currentModel = (event as { model?: unknown })?.model;
    requestRender?.();
  });

  const STATUSLINE_SUBCOMMANDS = [
    "click",
    "settings",
    "working",
    "thinking",
  ] as const;
  const WORKING_PRESETS = ["default", "pulse", "compact", "hidden"] as const;

  pi.registerCommand("statusline", {
    description: "Statusline actions: click, settings, working, or thinking",
    getArgumentCompletions: (prefix: string) => {
      const trimmedStart = prefix.trimStart();
      const trailingSpace = /\s$/.test(prefix);
      const parts = trimmedStart.split(/\s+/).filter(Boolean);
      if (parts.length === 0 || (parts.length === 1 && !trailingSpace)) {
        return prefixCompletions(parts[0] ?? "", STATUSLINE_SUBCOMMANDS);
      }
      if (
        parts[0] === "working" &&
        (parts.length === 1 || (parts.length === 2 && !trailingSpace))
      ) {
        return prefixCompletions(parts[1] ?? "", WORKING_PRESETS);
      }
      if (
        parts[0] === "click" &&
        (parts.length === 1 || (parts.length === 2 && !trailingSpace))
      ) {
        const segments = new Set([
          ...Object.keys(DEFAULT_CLICK_ACTIONS),
          ...Object.keys(config.clickActions ?? {}),
        ]);
        return prefixCompletions(parts[1] ?? "", segments);
      }
      return null;
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts[0] === "working") {
        if (typeof hostUi(ctx).setWorkingIndicator !== "function") {
          if (ctx.hasUI) {
            notify(
              ctx,
              "Working indicator customization is unavailable.",
              "info",
            );
          }
          return;
        }
        const preset = parts[1] ?? "default";
        if (preset === "default") hostUi(ctx).setWorkingIndicator();
        else if (preset === "pulse")
          hostUi(ctx).setWorkingIndicator({
            frames: ["●", "○"],
            intervalMs: 400,
          });
        else if (preset === "compact")
          hostUi(ctx).setWorkingIndicator({
            frames: ["⠋", "⠙", "⠹", "⠸"],
            intervalMs: 100,
          });
        else if (preset === "hidden")
          hostUi(ctx).setWorkingIndicator({ frames: [] });
        else {
          if (ctx.hasUI) {
            notify(
              ctx,
              "Usage: /statusline working default|pulse|compact|hidden",
              "error",
            );
          }
          return;
        }
        if (ctx.hasUI) notify(ctx, `Working indicator: ${preset}`, "info");
        return;
      }
      if (parts[0] === "thinking") {
        if (typeof hostUi(ctx).setHiddenThinkingLabel !== "function") {
          if (ctx.hasUI) {
            notify(ctx, "Thinking label customization is unavailable.", "info");
          }
          return;
        }
        const label = parts.slice(1).join(" ").trim();
        if (label === "" || label === "default") {
          hostUi(ctx).setHiddenThinkingLabel();
          if (ctx.hasUI) notify(ctx, "Thinking label: default", "info");
        } else {
          hostUi(ctx).setHiddenThinkingLabel(sanitizeTerminalText(label));
          if (ctx.hasUI)
            notify(
              ctx,
              `Thinking label: ${sanitizeTerminalText(label)}`,
              "info",
            );
        }
        return;
      }
      if (parts[0] === "settings") {
        if (!canOverlay(ctx)) {
          if (ctx.hasUI)
            notify(
              ctx,
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
              notify(
                ctx,
                `pi-statusline: failed to save settings: ${errorMessage(error)}`,
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
          (config.clickActions && Object.hasOwn(config.clickActions, segment)
            ? config.clickActions[segment]
            : undefined) ??
          (Object.hasOwn(DEFAULT_CLICK_ACTIONS, segment)
            ? DEFAULT_CLICK_ACTIONS[segment]
            : undefined);
        if (action) {
          if (action.startsWith("/")) {
            pi.sendUserMessage(action, { expandPromptTemplates: true });
            if (ctx.hasUI) notify(ctx, `Running: ${action}`, "info");
            return;
          }
          const [command, ...actionArgs] = action.trim().split(/\s+/);
          if (!command) return;
          if (ctx.hasUI) notify(ctx, `Running: ${action}`, "info");
          try {
            const result = await pi.exec(command, actionArgs);
            if (!ctx.hasUI) return;
            const output = sanitizeTerminalText(
              (result.stdout || result.stderr).trim(),
              { allowSgr: true },
            );
            if (output) {
              notify(ctx, output, result.code === 0 ? "info" : "error");
            }
            if (result.code !== 0) {
              notify(
                ctx,
                `pi-statusline: action exited with code ${result.code}`,
                "error",
              );
            }
          } catch (error) {
            if (ctx.hasUI) {
              notify(ctx, `pi-statusline: ${errorMessage(error)}`, "error");
            }
          }
        } else {
          if (ctx.hasUI) notify(ctx, `No click action for ${segment}`, "info");
        }
        return;
      }
      if (ctx.hasUI) {
        notify(
          ctx,
          "Usage: /statusline click <segment> | /statusline settings",
          "info",
        );
      }
    },
  });
}
