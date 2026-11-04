import { isAbsolute, resolve } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionContext,
  type ToolCallEvent,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import {
  loadModesConfig,
  loadPermissions,
  loadToolTags,
} from "@hollowheap/core/config";
import { displayTarget, truncateText } from "@hollowheap/core/format";
import {
  enterMode,
  evaluate,
  modeNames,
  replaceConfigModes,
  resetSession,
} from "@hollowheap/core/modes";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { dropSession, effectiveCwd, session } from "@hollowheap/core/state";
import type { Tag } from "@hollowheap/core/types";
import {
  TOOL_TAGS,
  isPassthroughTaskCall,
  readCommandArg,
  readToolTarget,
} from "@hollowheap/policy";
import { loadGuardConfig } from "./config.js";
import {
  calculateContextBreakdown,
  formatContextBreakdown,
} from "./context.js";
import {
  type DecisionEffect,
  checkPathTrust,
  persistDecision,
} from "./rules.js";
import { showTargetPicker } from "./target-picker.js";

interface TempGrant {
  target: string;
  expiresAt: number;
}

interface EventSink {
  emit(channel: string, data: unknown): void;
}

interface GuardRuntime {
  sessionDecisions: Map<unknown, Map<string, DecisionEffect>>;
  sessionGrants: Map<unknown, TempGrant[]>;
  sessionTargets: Map<unknown, Set<string>>;
  eventSink?: EventSink;
  lastOwner?: unknown;
}

function rememberTarget(
  runtime: GuardRuntime,
  owner: unknown,
  target: string,
): void {
  if (target === "" || target === ".") return;
  let targets = runtime.sessionTargets.get(owner);
  if (!targets) {
    targets = new Set();
    runtime.sessionTargets.set(owner, targets);
  }
  targets.delete(target);
  targets.add(target);
  while (targets.size > 50) {
    const oldest = targets.values().next().value;
    if (oldest === undefined) break;
    targets.delete(oldest);
  }
}

const GRANT_DURATIONS = ["30s", "5m", "15m", "1h"] as const;

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

function loadContextPermissions(ctx: ExtensionContext) {
  return loadPermissions({
    agentDir: getAgentDir(),
    workspaceRoot: ctx.cwd,
    trusted: ctx.isProjectTrusted(),
    onDiagnostic: (message) => ctx.ui.notify(`pi-guard: ${message}`, "warning"),
  });
}

function loadContextToolTags(ctx: ExtensionContext) {
  return loadToolTags({
    agentDir: getAgentDir(),
    workspaceRoot: ctx.cwd,
    trusted: ctx.isProjectTrusted(),
    onDiagnostic: (message) => ctx.ui.notify(`pi-guard: ${message}`, "warning"),
  });
}

function publishValues(runtime: GuardRuntime, owner: unknown): void {
  runtime.lastOwner = owner;
  if (runtime.eventSink === undefined) return;
  runtime.eventSink.emit("statusline:values", {
    name: "mode-guard",
    text: session(owner).mode.toUpperCase(),
  });
}

function nextMode(current: string): string {
  const names = modeNames();
  if (names.length === 0) return current;
  const index = names.indexOf(current);
  if (index < 0) return names[0] ?? current;
  return names[(index + 1) % names.length] ?? current;
}

async function requestApproval(
  toolName: string,
  target: string,
  ctx: ExtensionContext,
): Promise<{ block: true; reason: string } | undefined> {
  if (!ctx.hasUI) {
    return {
      block: true,
      reason: `pi-guard: ${toolName} ${displayTarget(target)} needs approval (no UI)`,
    };
  }
  const approved = await withPromptLock(() =>
    ctx.ui.confirm(`Allow ${toolName}?`, displayTarget(target)),
  );
  if (!approved) {
    return {
      block: true,
      reason: `pi-guard: ${toolName} ${displayTarget(target)} was not approved`,
    };
  }
  return undefined;
}

async function switchMode(
  runtime: GuardRuntime,
  ctx: ExtensionContext,
  raw: string,
): Promise<void> {
  const result = enterMode(ctx.sessionManager, raw);
  if (result.diagnostic !== undefined) {
    ctx.ui.notify(`pi-guard: ${result.diagnostic}`, "error");
    return;
  }
  if (result.veto !== undefined) {
    // A veto means the mode never became active, so its "on" notices would
    // misreport the session; only the refusal is shown.
    ctx.ui.notify(`pi-guard: ${result.veto}`, "error");
    return;
  }
  if (result.notices.length > 0) {
    for (const notice of result.notices) {
      ctx.ui.notify(`pi-guard: ${notice.text}`, notice.level);
    }
  } else {
    ctx.ui.notify(`pi-guard: mode ${result.mode}`);
  }
  publishValues(runtime, ctx.sessionManager);
}

async function pickGrantTarget(
  runtime: GuardRuntime,
  ctx: ExtensionContext,
): Promise<string | undefined> {
  const targets = [
    ...(runtime.sessionTargets.get(ctx.sessionManager) ?? []),
  ].reverse();
  if (targets.length === 0) {
    if (ctx.hasUI) {
      ctx.ui.notify(
        "No recent targets; use /grant <path-or-tool> <duration>",
        "info",
      );
    }
    return undefined;
  }
  if (ctx.mode === "tui" && typeof ctx.ui.custom === "function") {
    return showTargetPicker(ctx, targets);
  }
  if (ctx.hasUI) {
    ctx.ui.notify(`Recent targets:\n${targets.join("\n")}`, "info");
  }
  return undefined;
}

async function pickGrantDuration(
  ctx: ExtensionContext,
): Promise<string | undefined> {
  if (!ctx.hasUI || typeof ctx.ui.select !== "function") return undefined;
  return withPromptLock(() =>
    ctx.ui.select("Grant duration", ["5m", "15m", "1h"]),
  );
}

export default function (pi: ExtensionAPI) {
  const runtime: GuardRuntime = {
    sessionDecisions: new Map(),
    sessionGrants: new Map(),
    sessionTargets: new Map(),
    eventSink: pi.events,
  };
  pi.events.on("statusline:request", () => {
    if (runtime.lastOwner !== undefined) {
      publishValues(runtime, runtime.lastOwner);
    }
  });
  const handleToolCall = async (
    event: ToolCallEvent,
    ctx: ExtensionContext,
  ) => {
    if (isPassthroughTaskCall(event.toolName, event.input)) {
      return undefined;
    }
    const tag: Tag | undefined =
      TOOL_TAGS[event.toolName] ?? loadContextToolTags(ctx)[event.toolName];
    if (tag === undefined) {
      const raw = readToolTarget(event.toolName, event.input) ?? ".";
      return requestApproval(event.toolName, raw, ctx);
    }
    if (tag !== "shell") {
      const cwd = effectiveCwd(ctx.cwd, ctx.sessionManager);
      if (cwd !== ctx.cwd) {
        const record = event.input as Record<string, unknown>;
        if (
          typeof record.path === "string" &&
          record.path !== "" &&
          !isAbsolute(record.path)
        ) {
          record.path = resolve(cwd, record.path);
        }
      }
    }
    const target =
      tag === "shell"
        ? readCommandArg(event.input)
        : (readToolTarget(event.toolName, event.input) ?? ".");
    rememberTarget(runtime, ctx.sessionManager, target);

    if (tag !== "shell") {
      const guardConfig = loadGuardConfig(getAgentDir());
      const sessionMap = runtime.sessionDecisions.get(ctx.sessionManager);
      const trust = checkPathTrust(
        target,
        ctx.cwd,
        guardConfig.trustedRoots ?? [],
        sessionMap,
        guardConfig.decisions,
      );

      if (trust.isOutsideWorkspace) {
        if (trust.isTrusted) {
          if (session(ctx.sessionManager).mode === "plan" && tag === "edit") {
            return {
              block: true,
              reason: `pi-guard: ${tag} access to ${displayTarget(target)} is denied`,
            };
          }
          return undefined;
        }
        if (trust.cachedDecision === "deny") {
          return {
            block: true,
            reason: `pi-guard: ${tag} access to ${displayTarget(target)} is denied`,
          };
        }

        if (!ctx.hasUI || typeof ctx.ui.select !== "function") {
          return {
            block: true,
            reason: `pi-guard: ${tag} access to out-of-workspace ${displayTarget(target)} is denied`,
          };
        }

        const choice = await withPromptLock(() =>
          ctx.ui.select(
            `Allow access to out-of-workspace path ${displayTarget(target)}?`,
            [
              "Allow (this session)",
              "Allow indefinitely",
              "Ask (this session)",
              "Deny (this session)",
              "Deny indefinitely",
            ],
          ),
        );

        if (choice === undefined) {
          return {
            block: true,
            reason: `pi-guard: ${tag} access to out-of-workspace ${displayTarget(target)} is denied`,
          };
        }

        let currentSessionMap = runtime.sessionDecisions.get(
          ctx.sessionManager,
        );
        if (!currentSessionMap) {
          currentSessionMap = new Map();
          runtime.sessionDecisions.set(ctx.sessionManager, currentSessionMap);
        }

        if (choice === "Allow (this session)") {
          persistDecision(
            getAgentDir(),
            trust.canonicalPath,
            "allow",
            "session",
            currentSessionMap,
          );
          if (session(ctx.sessionManager).mode === "plan" && tag === "edit") {
            return {
              block: true,
              reason: `pi-guard: ${tag} access to ${displayTarget(target)} is denied`,
            };
          }
          return undefined;
        }
        if (choice === "Allow indefinitely") {
          persistDecision(
            getAgentDir(),
            trust.canonicalPath,
            "allow",
            "indefinite",
            currentSessionMap,
          );
          if (session(ctx.sessionManager).mode === "plan" && tag === "edit") {
            return {
              block: true,
              reason: `pi-guard: ${tag} access to ${displayTarget(target)} is denied`,
            };
          }
          return undefined;
        }
        if (choice === "Ask (this session)") {
          persistDecision(
            getAgentDir(),
            trust.canonicalPath,
            "ask",
            "session",
            currentSessionMap,
          );
          return requestApproval(event.toolName, target, ctx);
        }
        if (choice === "Deny (this session)") {
          persistDecision(
            getAgentDir(),
            trust.canonicalPath,
            "deny",
            "session",
            currentSessionMap,
          );
          return {
            block: true,
            reason: `pi-guard: ${tag} access to ${displayTarget(target)} is denied`,
          };
        }
        if (choice === "Deny indefinitely") {
          persistDecision(
            getAgentDir(),
            trust.canonicalPath,
            "deny",
            "indefinite",
            currentSessionMap,
          );
          return {
            block: true,
            reason: `pi-guard: ${tag} access to ${displayTarget(target)} is denied`,
          };
        }
      }
    }

    // Check temporary grants
    const grants = runtime.sessionGrants.get(ctx.sessionManager) ?? [];
    const now = Date.now();
    const activeGrant = grants.find(
      (g) => g.target === target && g.expiresAt > now,
    );
    if (activeGrant) {
      return undefined;
    }

    const verdict = evaluate({
      owner: ctx.sessionManager,
      cwd: ctx.cwd,
      tag,
      target,
      rules: loadContextPermissions(ctx),
    });
    if (verdict === "deny") {
      return {
        block: true,
        reason: `pi-guard: ${tag} access to ${displayTarget(target)} is denied`,
      };
    }
    if (verdict === "ask") return requestApproval(event.toolName, target, ctx);
    return undefined;
  };

  pi.on("tool_call", async (event, ctx) => {
    try {
      return await handleToolCall(event, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        block: true,
        reason: `pi-guard: tool call check failed: ${message}`,
      };
    }
  });
  pi.on("tool_result", (event, _ctx) => {
    if (event.toolName !== "bash" || !Array.isArray(event.content)) {
      return undefined;
    }
    let changed = false;
    const content = event.content.map((block) => {
      if (block.type !== "text") return block;
      const text = truncateText(block.text, "pi-guard");
      if (text === block.text) return block;
      changed = true;
      return { ...block, text };
    });
    if (!changed) return undefined;
    return { content };
  });
  pi.on("session_start", (_event, ctx) => {
    const restored = resetSession(ctx.sessionManager);
    if (restored.diagnostic !== undefined) {
      ctx.ui.notify(`pi-guard: ${restored.diagnostic}`, "warning");
    }
    if (restored.veto !== undefined) {
      ctx.ui.notify(`pi-guard: ${restored.veto}`, "error");
    }
    const notify = (message: string) =>
      ctx.ui.notify(`pi-guard: ${message}`, "warning");
    replaceConfigModes(loadModesConfig(getAgentDir(), notify), notify);
    publishValues(runtime, ctx.sessionManager);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    runtime.sessionDecisions.delete(ctx.sessionManager);
    runtime.sessionGrants.delete(ctx.sessionManager);
    runtime.sessionTargets.delete(ctx.sessionManager);
    dropSession(ctx.sessionManager);
  });
  pi.registerCommand("mode", {
    description: "Show or switch the plan/approval mode",
    getArgumentCompletions: (prefix: string) => {
      const lower = prefix.trim().toLowerCase();
      return modeNames()
        .filter((mode) => mode.startsWith(lower))
        .map((mode) => ({ value: mode, label: mode }));
    },
    handler: async (args, ctx) => {
      const raw = args.trim().toLowerCase();
      if (raw === "") {
        ctx.ui.notify(
          `pi-guard: mode ${session(ctx.sessionManager).mode} (${modeNames().join(", ")})`,
        );
        return;
      }
      await switchMode(runtime, ctx, raw);
    },
  });
  pi.registerShortcut(Key.alt("m"), {
    description: "Cycle plan/approval mode",
    handler: (ctx) =>
      switchMode(runtime, ctx, nextMode(session(ctx.sessionManager).mode)),
  });

  pi.registerCommand("grant", {
    description: "Grant temporary permission: /grant [path-or-tool] [duration]",
    getArgumentCompletions: (prefix: string) => {
      const parts = prefix.trimStart().split(/\s+/);
      if (parts.length === 1) {
        const query = (parts[0] ?? "").toLowerCase();
        const targets = [
          ...(runtime.sessionTargets.get(runtime.lastOwner) ??
            new Set<string>()),
        ].reverse();
        return targets
          .filter((target) => target.toLowerCase().startsWith(query))
          .map((target) => ({
            value: target,
            label: target,
            description: "recent permission target",
          }));
      }
      if (parts.length === 2) {
        const query = (parts[1] ?? "").toLowerCase();
        return GRANT_DURATIONS.filter((duration) =>
          duration.startsWith(query),
        ).map((duration) => ({
          value: duration,
          label: duration,
          description: "grant duration",
        }));
      }
      return null;
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      let target = parts.length > 0 ? parts[0] : undefined;
      let durationStr: string | undefined;
      if (parts.length === 0) {
        target = await pickGrantTarget(runtime, ctx);
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
          ctx.ui.notify(
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
          ctx.ui.notify("Invalid duration. Use e.g. 5m, 1h, 30s", "error");
        }
        return;
      }
      let grants = runtime.sessionGrants.get(ctx.sessionManager);
      if (!grants) {
        grants = [];
        runtime.sessionGrants.set(ctx.sessionManager, grants);
      }
      grants.push({ target, expiresAt: Date.now() + durationMs });
      rememberTarget(runtime, ctx.sessionManager, target);
      if (ctx.hasUI) {
        ctx.ui.notify(`Granted ${target} for ${durationStr}`, "info");
      }
    },
  });

  pi.registerCommand("grants", {
    description: "List active temporary permission grants",
    handler: async (_args, ctx) => {
      const grants = runtime.sessionGrants.get(ctx.sessionManager) ?? [];
      const now = Date.now();
      const active = grants.filter((g) => g.expiresAt > now);
      if (active.length === 0) {
        if (ctx.hasUI) ctx.ui.notify("No active grants", "info");
        return;
      }
      const text = active
        .map(
          (g) =>
            `${g.target} (expires in ${Math.ceil((g.expiresAt - now) / 1000)}s)`,
        )
        .join("\n");
      if (ctx.hasUI) ctx.ui.notify(text, "info");
    },
  });
  pi.registerCommand("context", {
    description: "Show context window usage broken down by category",
    handler: async (_args, ctx) => {
      const branch = ctx.sessionManager?.getBranch?.();
      const entries = Array.isArray(branch) ? branch : [];
      const model = ctx.model as { contextWindow?: number } | undefined;
      const breakdown = calculateContextBreakdown(entries, {
        limit: model?.contextWindow,
      });
      const text = formatContextBreakdown(breakdown);
      if (ctx.hasUI) {
        ctx.ui.notify(text);
      } else {
        console.log(text);
      }
    },
  });
}
