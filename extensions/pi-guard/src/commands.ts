import {
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { effectiveCwd, session } from "@hollowheap/core/state";
import {
  canOverlay,
  hostUi,
  notify,
  selectDialog,
} from "@hollowheap/pi-ui/host";
import {
  calculateContextBreakdown,
  formatContextBreakdown,
} from "./context.js";
import { show } from "./settings-ui.js";
import { formatStatus, loadConfig } from "./settings.js";
import {
  type GuardState,
  getActiveGrantCount,
  getActiveGrants,
  getOrCreate,
  guardWarn,
  publishSnapshot,
  rememberTarget,
} from "./state.js";

const GRANT_DURATIONS = ["30s", "5m", "15m", "1h"] as const;
const GRANT_SUBCOMMANDS = ["list"] as const;
const GUARD_SUBCOMMANDS = ["settings", "status"] as const;

/** Pick a recently checked permission target with fuzzy search. */
export async function showGrantPicker(
  ctx: ExtensionContext,
  targets: readonly string[],
): Promise<string | undefined> {
  const { showFuzzyPicker } = await import("@hollowheap/pi-ui/picker");
  return showFuzzyPicker(ctx, {
    title: "Grant temporary permission",
    emptyText: "No matching targets",
    items: targets.map((target) => ({
      value: target,
      label: target,
      description: "recent permission target",
    })),
  });
}

function parseDuration(str: string): number | null {
  const match = str.match(/^(\d+)(s|m|h)$/);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === "s") return value * 1000;
  if (unit === "m") return value * 60 * 1000;
  if (unit === "h") return value * 60 * 60 * 1000;
  return null;
}

function listActiveGrants(state: GuardState, ctx: ExtensionContext): void {
  const now = Date.now();
  const active = getActiveGrants(state, ctx.sessionManager, now);
  if (active.length === 0) {
    if (ctx.hasUI) notify(ctx, "No active grants", "info");
    return;
  }
  const text = active
    .map(
      (g) =>
        `${sanitizeTerminalText(g.target)} (expires in ${Math.ceil((g.expiresAt - now) / 1000)}s)`,
    )
    .join("\n");
  if (ctx.hasUI) notify(ctx, text, "info");
}

async function pickGrantTarget(
  state: GuardState,
  ctx: ExtensionContext,
): Promise<string | undefined> {
  const targets = [
    ...(state.sessionTargets.get(ctx.sessionManager) ?? []),
  ].reverse();
  if (targets.length === 0) {
    if (ctx.hasUI) {
      notify(
        ctx,
        "No recent targets; use /grant <path-or-tool> <duration>",
        "info",
      );
    }
    return undefined;
  }
  if (canOverlay(ctx)) {
    return showGrantPicker(ctx, targets);
  }
  if (ctx.hasUI) {
    notify(
      ctx,
      `Recent targets:\n${targets.map((t) => sanitizeTerminalText(t)).join("\n")}`,
      "info",
    );
  }
  return undefined;
}

async function pickGrantDuration(
  ctx: ExtensionContext,
): Promise<string | undefined> {
  if (!ctx.hasUI || typeof hostUi(ctx).select !== "function") return undefined;
  return withPromptLock(() =>
    selectDialog(ctx, "Grant duration", ["5m", "15m", "1h"], {
      signal: (ctx as { signal?: AbortSignal }).signal,
    }),
  );
}

function completeGrantArgs(state: GuardState, prefix: string) {
  const parts = prefix.trimStart().split(/\s+/);
  if (parts.length === 1) {
    const query = (parts[0] ?? "").toLowerCase();
    const targets = [
      ...(state.sessionTargets.get(state.lastOwner) ?? new Set<string>()),
    ].reverse();
    return [
      ...GRANT_SUBCOMMANDS.filter((sub) => sub.startsWith(query)).map(
        (sub) => ({
          value: sub,
          label: sub,
          description: "list active grants",
        }),
      ),
      ...targets
        .filter((target) => target.toLowerCase().startsWith(query))
        .map((target) => ({
          value: target,
          label: target,
          description: "recent permission target",
        })),
    ];
  }
  if (parts.length === 2) {
    const query = (parts[1] ?? "").toLowerCase();
    return GRANT_DURATIONS.filter((duration) => duration.startsWith(query)).map(
      (duration) => ({
        value: duration,
        label: duration,
        description: "grant duration",
      }),
    );
  }
  return null;
}

async function handleGrantCommand(
  state: GuardState,
  args: string,
  ctx: ExtensionContext,
): Promise<void> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts[0] === "list") {
    listActiveGrants(state, ctx);
    return;
  }
  let target = parts.length > 0 ? parts[0] : undefined;
  let durationStr: string | undefined;
  if (parts.length === 0) {
    target = await pickGrantTarget(state, ctx);
  } else if (parts.length === 1) {
    target = parts[0];
  } else {
    target = parts.slice(0, -1).join(" ");
    durationStr = parts[parts.length - 1];
  }
  if (target === undefined || target === "") return;
  durationStr ??= await pickGrantDuration(ctx);
  if (durationStr === undefined) {
    if (ctx.hasUI) {
      notify(
        ctx,
        parts.length === 0
          ? "Grant cancelled"
          : "Usage: /grant [path-or-tool] [duration]",
        "info",
      );
    }
    return;
  }
  const durationMs = parseDuration(durationStr);
  if (durationMs === null) {
    if (ctx.hasUI) {
      notify(ctx, "Invalid duration. Use e.g. 5m, 1h, 30s", "error");
    }
    return;
  }
  const grants = getOrCreate(state.sessionGrants, ctx.sessionManager, () => []);
  grants.push({ target, expiresAt: Date.now() + durationMs });
  rememberTarget(state, ctx.sessionManager, target);
  publishSnapshot(state, ctx.sessionManager);
  if (ctx.hasUI) {
    notify(
      ctx,
      `Granted ${sanitizeTerminalText(target)} for ${durationStr}`,
      "info",
    );
  }
}

function handleContextCommand(ctx: ExtensionContext): void {
  const branch = ctx.sessionManager?.getBranch?.();
  const entries = Array.isArray(branch) ? branch : [];
  const model = ctx.model as { contextWindow?: number } | undefined;
  const breakdown = calculateContextBreakdown(entries, {
    limit: model?.contextWindow,
  });
  const text = formatContextBreakdown(breakdown);
  if (ctx.hasUI) notify(ctx, text);
  else console.log(text);
}

function completeGuardArgs(prefix: string) {
  const trimmedStart = prefix.trimStart();
  const trailingSpace = /\s$/.test(prefix);
  const parts = trimmedStart.split(/\s+/).filter(Boolean);
  if (parts.length === 0 || (parts.length === 1 && !trailingSpace)) {
    const query = (parts[0] ?? "").toLowerCase();
    return GUARD_SUBCOMMANDS.filter((sub) => sub.startsWith(query)).map(
      (sub) => ({ value: sub, label: sub }),
    );
  }
  return null;
}

function formatGuardStatus(
  state: GuardState,
  agentDir: string,
  ctx: ExtensionContext,
): string {
  const config = loadConfig(agentDir, guardWarn(ctx));
  return formatStatus({
    mode: session(ctx.sessionManager).mode,
    agentDir,
    trustedRootsCount: (config.trustedRoots ?? []).length,
    savedDecisionsCount: Object.keys(config.decisions ?? {}).length,
    activeGrantsCount: getActiveGrantCount(state, ctx.sessionManager),
  });
}

function clearSessionGrants(state: GuardState, owner: unknown): number {
  const activeCount = getActiveGrantCount(state, owner);
  state.sessionGrants.delete(owner);
  publishSnapshot(state, owner);
  return activeCount;
}

async function handleGuardCommand(
  state: GuardState,
  args: string,
  ctx: ExtensionContext,
): Promise<void> {
  const sub = args.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const agentDir = getAgentDir();

  if (sub === "status") {
    const summary = formatGuardStatus(state, agentDir, ctx);
    if (ctx.hasUI) notify(ctx, `pi-guard: ${summary}`, "info");
    else console.log(summary);
    return;
  }

  if (sub === "" || sub === "settings") {
    if (!canOverlay(ctx)) {
      const summary = formatGuardStatus(state, agentDir, ctx);
      if (ctx.hasUI) {
        notify(ctx, `Guard settings require TUI mode (${summary})`, "info");
      } else {
        console.log(summary);
      }
      return;
    }
    await show({
      ctx,
      agentDir,
      cwd: effectiveCwd(ctx.cwd, ctx.sessionManager),
      activeGrantCount: () => getActiveGrantCount(state, ctx.sessionManager),
      onClearGrants: () => clearSessionGrants(state, ctx.sessionManager),
    });
    return;
  }

  if (ctx.hasUI) {
    notify(ctx, "Usage: /guard [settings|status]", "error");
  }
}

export function createCommands(state: GuardState) {
  return {
    grant: {
      description:
        "Grant temporary permission: /grant [path-or-tool] [duration]",
      getArgumentCompletions: (prefix: string) =>
        completeGrantArgs(state, prefix),
      handler: (args: string, ctx: ExtensionContext) =>
        handleGrantCommand(state, args, ctx),
    },
    context: {
      description: "Show context window usage broken down by category",
      handler: async (_args: string, ctx: ExtensionContext) =>
        handleContextCommand(ctx),
    },
    guard: {
      description:
        "Inspect or configure pi-guard settings: /guard [settings|status]",
      getArgumentCompletions: completeGuardArgs,
      handler: (args: string, ctx: ExtensionContext) =>
        handleGuardCommand(state, args, ctx),
    },
  };
}
