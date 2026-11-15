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
import {
  displayTarget,
  sanitizeTerminalText,
  truncateText,
} from "@hollowheap/core/format";
import {
  enterMode,
  evaluate,
  modeNames,
  replaceConfigModes,
  resetSession,
} from "@hollowheap/core/modes";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { dropSession, effectiveCwd, session } from "@hollowheap/core/state";
import type { Tag } from "@hollowheap/core/types";
import {
  TOOL_TAGS,
  isPassthroughTaskCall,
  readCommandArg,
  readToolTarget,
} from "@hollowheap/policy";
import { getActiveTuiConfig } from "@hollowheap/tui/state";
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
import { formatGuardStatus, showGuardSettings } from "./settings.js";

export const GUARD_AUDIT_TYPE = "hollowheap.guard.audit";

export interface GuardAudit {
  decisionCount: number;
  deniedCount: number;
  approvedTagsCount: number;
  updatedAt?: number;
}

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
  sessionApprovedTags: Map<unknown, Map<string, Set<string>>>;
  sessionAudits: Map<unknown, GuardAudit>;
  trustedByOwner: Map<unknown, boolean>;
  eventSink?: EventSink;
  lastOwner?: unknown;
}

function getAudit(runtime: GuardRuntime, owner: unknown): GuardAudit {
  let audit = runtime.sessionAudits.get(owner);
  if (!audit) {
    audit = { decisionCount: 0, deniedCount: 0, approvedTagsCount: 0 };
    runtime.sessionAudits.set(owner, audit);
  }
  return audit;
}

function getActiveGrantCount(runtime: GuardRuntime, owner: unknown): number {
  const grants = runtime.sessionGrants.get(owner) ?? [];
  const now = Date.now();
  return grants.filter((g) => g.expiresAt > now).length;
}

function persistGuardAudit(
  pi: ExtensionAPI | undefined,
  owner: unknown,
  audit: GuardAudit,
): void {
  const updatedAt = Date.now();
  audit.updatedAt = updatedAt;
  const data = {
    decisionCount: audit.decisionCount,
    deniedCount: audit.deniedCount,
    approvedTagsCount: audit.approvedTagsCount,
    updatedAt,
  };
  try {
    if (typeof pi?.appendEntry === "function") {
      pi.appendEntry(GUARD_AUDIT_TYPE, data);
    } else {
      const s = owner as
        | {
            appendCustomEntry?: (t: string, d: unknown) => void;
            appendEntry?: (t: string, d: unknown) => void;
          }
        | undefined;
      if (typeof s?.appendCustomEntry === "function") {
        s.appendCustomEntry(GUARD_AUDIT_TYPE, data);
      } else if (typeof s?.appendEntry === "function") {
        s.appendEntry(GUARD_AUDIT_TYPE, data);
      }
    }
  } catch {
    // Non-fatal
  }
}

function publishGuardSnapshot(runtime: GuardRuntime, owner: unknown): void {
  if (owner === undefined || owner === null) return;
  const audit = getAudit(runtime, owner);
  const trusted = runtime.trustedByOwner.get(owner) ?? false;
  const activeGrantCount = getActiveGrantCount(runtime, owner);
  updateSessionSnapshot(owner, "guard", {
    trusted,
    decisionCount: audit.decisionCount,
    activeGrantCount,
    approvedTagsCount: audit.approvedTagsCount,
    deniedCount: audit.deniedCount,
    updatedAt: audit.updatedAt ?? Date.now(),
  });
}

function restoreAuditCounters(owner: unknown): GuardAudit {
  const sessionObj = owner as
    | {
        getBranch?: () => readonly unknown[];
        getEntries?: () => readonly unknown[];
      }
    | undefined;
  let entries: readonly unknown[] | undefined;
  if (typeof sessionObj?.getBranch === "function") {
    try {
      entries = sessionObj.getBranch();
    } catch {
      entries = undefined;
    }
  }
  if (!entries && typeof sessionObj?.getEntries === "function") {
    try {
      entries = sessionObj.getEntries();
    } catch {
      entries = undefined;
    }
  }
  if (!entries || !Array.isArray(entries)) {
    return { decisionCount: 0, deniedCount: 0, approvedTagsCount: 0 };
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as
      | {
          type?: string;
          customType?: string;
          data?: unknown;
        }
      | undefined;
    if (
      entry?.customType === GUARD_AUDIT_TYPE ||
      entry?.type === GUARD_AUDIT_TYPE
    ) {
      const data = entry.data as
        | {
            decisionCount?: unknown;
            deniedCount?: unknown;
            approvedTagsCount?: unknown;
            updatedAt?: unknown;
          }
        | undefined;
      if (typeof data === "object" && data !== null) {
        return {
          decisionCount:
            typeof data.decisionCount === "number" ? data.decisionCount : 0,
          deniedCount:
            typeof data.deniedCount === "number" ? data.deniedCount : 0,
          approvedTagsCount:
            typeof data.approvedTagsCount === "number"
              ? data.approvedTagsCount
              : 0,
          updatedAt:
            typeof data.updatedAt === "number" ? data.updatedAt : undefined,
        };
      }
    }
  }
  return { decisionCount: 0, deniedCount: 0, approvedTagsCount: 0 };
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

const SHORT_GUARD_MODE_MAP: Record<string, string> = {
  ASK: "A",
  EDIT: "E",
  PLAN: "P",
  AUTOPILOT: "AP",
};

export function formatGuardModeBadge(
  mode: string,
  shortMode = getActiveTuiConfig().shortMode,
): string {
  const upper = mode.trim().toUpperCase();
  if (!shortMode) return upper;
  const mapped = SHORT_GUARD_MODE_MAP[upper];
  if (mapped !== undefined) return mapped;
  return upper.slice(0, 1);
}

function publishValues(runtime: GuardRuntime, owner: unknown): void {
  runtime.lastOwner = owner;
  if (owner !== undefined && owner !== null) {
    updateSessionSnapshot(owner, "mode", {
      name: session(owner).mode,
      updatedAt: Date.now(),
    });
    publishGuardSnapshot(runtime, owner);
  }
  if (runtime.eventSink === undefined) return;
  runtime.eventSink.emit("statusline:values", {
    name: "mode-guard",
    text: formatGuardModeBadge(session(owner).mode),
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
  runtime: GuardRuntime,
  toolName: string,
  target: string,
  ctx: ExtensionContext,
  pi?: ExtensionAPI,
): Promise<{ block: true; reason: string } | undefined> {
  const audit = getAudit(runtime, ctx.sessionManager);
  if (!ctx.hasUI) {
    audit.deniedCount++;
    persistGuardAudit(pi, ctx.sessionManager, audit);
    publishGuardSnapshot(runtime, ctx.sessionManager);
    return {
      block: true,
      reason: `pi-guard: ${toolName} ${displayTarget(target)} needs approval (no UI)`,
    };
  }
  const sanitizedTarget = sanitizeTerminalText(target);
  const approved = await withPromptLock(() =>
    ctx.ui.confirm(`Allow ${toolName}?`, sanitizedTarget),
  );
  audit.decisionCount++;
  if (!approved) {
    audit.deniedCount++;
    persistGuardAudit(pi, ctx.sessionManager, audit);
    publishGuardSnapshot(runtime, ctx.sessionManager);
    return {
      block: true,
      reason: `pi-guard: ${toolName} ${displayTarget(target)} was not approved`,
    };
  }
  persistGuardAudit(pi, ctx.sessionManager, audit);
  publishGuardSnapshot(runtime, ctx.sessionManager);
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
    const { showTargetPicker } = await import("./target-picker.js");
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
    sessionApprovedTags: new Map(),
    sessionAudits: new Map(),
    trustedByOwner: new Map(),
    eventSink: pi.events,
  };
  pi.events.on("statusline:request", () => {
    if (runtime.lastOwner !== undefined) {
      publishValues(runtime, runtime.lastOwner);
    }
  });
  pi.events.on("tui:config-changed", () => {
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
      if (session(ctx.sessionManager).mode === "autopilot") {
        return undefined;
      }
      const raw = readToolTarget(event.toolName, event.input) ?? ".";
      return requestApproval(runtime, event.toolName, raw, ctx, pi);
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
      const guardConfig = loadGuardConfig(getAgentDir(), (msg) => {
        if (ctx.hasUI) ctx.ui.notify(`pi-guard: ${msg}`, "warning");
      });
      const sessionMap = runtime.sessionDecisions.get(ctx.sessionManager);
      const trust = checkPathTrust(
        target,
        ctx.cwd,
        guardConfig.trustedRoots ?? [],
        sessionMap,
        guardConfig.decisions,
      );

      if (trust.isOutsideWorkspace) {
        if (trust.cachedDecision === "deny") {
          const audit = getAudit(runtime, ctx.sessionManager);
          audit.deniedCount++;
          persistGuardAudit(pi, ctx.sessionManager, audit);
          publishGuardSnapshot(runtime, ctx.sessionManager);
          return {
            block: true,
            reason: `pi-guard: ${tag} access to ${displayTarget(target)} is denied`,
          };
        }
        if (trust.isTrusted) {
          if (session(ctx.sessionManager).mode === "plan" && tag === "edit") {
            const audit = getAudit(runtime, ctx.sessionManager);
            audit.deniedCount++;
            persistGuardAudit(pi, ctx.sessionManager, audit);
            publishGuardSnapshot(runtime, ctx.sessionManager);
            return {
              block: true,
              reason: `pi-guard: ${tag} access to ${displayTarget(target)} is denied`,
            };
          }
          const approvedTags = runtime.sessionApprovedTags
            .get(ctx.sessionManager)
            ?.get(trust.canonicalPath);
          if (
            (tag === "edit" || tag === "write") &&
            approvedTags !== undefined &&
            !approvedTags.has(tag) &&
            !approvedTags.has("write") &&
            !approvedTags.has("edit")
          ) {
            // Read approval never allows edit or write; proceed to ask dialog below
          } else {
            const verdict = evaluate({
              owner: ctx.sessionManager,
              cwd: ctx.cwd,
              tag,
              target,
              rules: loadContextPermissions(ctx),
            });
            if (verdict === "deny") {
              const audit = getAudit(runtime, ctx.sessionManager);
              audit.deniedCount++;
              persistGuardAudit(pi, ctx.sessionManager, audit);
              publishGuardSnapshot(runtime, ctx.sessionManager);
              return {
                block: true,
                reason: `pi-guard: ${tag} access to ${displayTarget(target)} is denied`,
              };
            }
            return undefined;
          }
        }

        if (!ctx.hasUI || typeof ctx.ui.select !== "function") {
          const audit = getAudit(runtime, ctx.sessionManager);
          audit.deniedCount++;
          persistGuardAudit(pi, ctx.sessionManager, audit);
          publishGuardSnapshot(runtime, ctx.sessionManager);
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

        const audit = getAudit(runtime, ctx.sessionManager);
        if (choice === undefined) {
          audit.deniedCount++;
          persistGuardAudit(pi, ctx.sessionManager, audit);
          publishGuardSnapshot(runtime, ctx.sessionManager);
          return {
            block: true,
            reason: `pi-guard: ${tag} access to out-of-workspace ${displayTarget(target)} is denied`,
          };
        }

        audit.decisionCount++;

        let currentSessionMap = runtime.sessionDecisions.get(
          ctx.sessionManager,
        );
        if (!currentSessionMap) {
          currentSessionMap = new Map();
          runtime.sessionDecisions.set(ctx.sessionManager, currentSessionMap);
        }

        if (
          choice === "Allow (this session)" ||
          choice === "Allow indefinitely"
        ) {
          let currentApprovedTags = runtime.sessionApprovedTags.get(
            ctx.sessionManager,
          );
          if (!currentApprovedTags) {
            currentApprovedTags = new Map();
            runtime.sessionApprovedTags.set(
              ctx.sessionManager,
              currentApprovedTags,
            );
          }
          let tags = currentApprovedTags.get(trust.canonicalPath);
          if (!tags) {
            tags = new Set();
            currentApprovedTags.set(trust.canonicalPath, tags);
          }
          if (!tags.has(tag)) {
            tags.add(tag);
            audit.approvedTagsCount++;
          }
        }

        if (choice === "Allow (this session)") {
          persistDecision(
            getAgentDir(),
            trust.canonicalPath,
            "allow",
            "session",
            currentSessionMap,
            (msg, t) => ctx.ui.notify(msg, t),
          );
          persistGuardAudit(pi, ctx.sessionManager, audit);
          publishGuardSnapshot(runtime, ctx.sessionManager);
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
            (msg, t) => ctx.ui.notify(msg, t),
          );
          persistGuardAudit(pi, ctx.sessionManager, audit);
          publishGuardSnapshot(runtime, ctx.sessionManager);
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
            (msg, t) => ctx.ui.notify(msg, t),
          );
          persistGuardAudit(pi, ctx.sessionManager, audit);
          publishGuardSnapshot(runtime, ctx.sessionManager);
          return requestApproval(runtime, event.toolName, target, ctx, pi);
        }
        if (choice === "Deny (this session)") {
          audit.deniedCount++;
          persistGuardAudit(pi, ctx.sessionManager, audit);
          publishGuardSnapshot(runtime, ctx.sessionManager);
          persistDecision(
            getAgentDir(),
            trust.canonicalPath,
            "deny",
            "session",
            currentSessionMap,
            (msg, t) => ctx.ui.notify(msg, t),
          );
          return {
            block: true,
            reason: `pi-guard: ${tag} access to ${displayTarget(target)} is denied`,
          };
        }
        if (choice === "Deny indefinitely") {
          audit.deniedCount++;
          persistGuardAudit(pi, ctx.sessionManager, audit);
          publishGuardSnapshot(runtime, ctx.sessionManager);
          persistDecision(
            getAgentDir(),
            trust.canonicalPath,
            "deny",
            "indefinite",
            currentSessionMap,
            (msg, t) => ctx.ui.notify(msg, t),
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
      const audit = getAudit(runtime, ctx.sessionManager);
      audit.deniedCount++;
      persistGuardAudit(pi, ctx.sessionManager, audit);
      publishGuardSnapshot(runtime, ctx.sessionManager);
      return {
        block: true,
        reason: `pi-guard: ${tag} access to ${displayTarget(target)} is denied`,
      };
    }
    if (verdict === "ask")
      return requestApproval(runtime, event.toolName, target, ctx, pi);
    return undefined;
  };

  pi.on("tool_call", async (event, ctx) => {
    try {
      runtime.trustedByOwner.set(
        ctx.sessionManager,
        ctx.isProjectTrusted?.() ?? false,
      );
      return await handleToolCall(event, ctx);
    } catch (error) {
      const audit = getAudit(runtime, ctx.sessionManager);
      audit.deniedCount++;
      persistGuardAudit(pi, ctx.sessionManager, audit);
      publishGuardSnapshot(runtime, ctx.sessionManager);
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
  const restore = (ctx: ExtensionContext) => {
    const notify = (message: string) =>
      ctx.ui.notify(`pi-guard: ${message}`, "warning");
    replaceConfigModes(loadModesConfig(getAgentDir(), notify), notify);
    const restored = resetSession(ctx.sessionManager);
    if (restored.diagnostic !== undefined) {
      ctx.ui.notify(`pi-guard: ${restored.diagnostic}`, "warning");
    }
    if (restored.veto !== undefined) {
      ctx.ui.notify(`pi-guard: ${restored.veto}`, "error");
    }
    const trusted = ctx.isProjectTrusted?.() ?? false;
    runtime.trustedByOwner.set(ctx.sessionManager, trusted);
    const restoredAudit = restoreAuditCounters(ctx.sessionManager);
    runtime.sessionAudits.set(ctx.sessionManager, restoredAudit);
    publishValues(runtime, ctx.sessionManager);
  };
  pi.on("session_start", (_event, ctx) => {
    restore(ctx);
  });
  pi.on("session_tree", (_event, ctx) => {
    restore(ctx);
  });
  pi.on("session_compact", (_event, ctx) => {
    const owner = ctx?.sessionManager ?? runtime.lastOwner;
    if (!owner) return;
    const audit = runtime.sessionAudits.get(owner);
    if (
      audit &&
      (audit.decisionCount > 0 ||
        audit.deniedCount > 0 ||
        audit.approvedTagsCount > 0)
    ) {
      persistGuardAudit(pi, owner, audit);
    }
  });
  pi.on("session_shutdown", (_event, ctx) => {
    runtime.sessionDecisions.delete(ctx.sessionManager);
    runtime.sessionGrants.delete(ctx.sessionManager);
    runtime.sessionTargets.delete(ctx.sessionManager);
    runtime.sessionApprovedTags.delete(ctx.sessionManager);
    runtime.sessionAudits.delete(ctx.sessionManager);
    runtime.trustedByOwner.delete(ctx.sessionManager);
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
      publishGuardSnapshot(runtime, ctx.sessionManager);
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

  const GUARD_SUBCOMMANDS = ["settings", "config", "status"] as const;
  pi.registerCommand("guard", {
    description:
      "Inspect or configure pi-guard settings: /guard [settings|config|status]",
    getArgumentCompletions: (prefix: string) => {
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
    },
    handler: async (args, ctx) => {
      const sub = args.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      const agentDir = getAgentDir();
      const warn = (msg: string) => {
        if (ctx.hasUI) {
          ctx.ui.notify(`pi-guard: ${msg}`, "warning");
        }
      };

      if (sub === "status") {
        const config = loadGuardConfig(agentDir, warn);
        const summary = formatGuardStatus({
          mode: session(ctx.sessionManager).mode,
          agentDir,
          trustedRootsCount: (config.trustedRoots ?? []).length,
          savedDecisionsCount: Object.keys(config.decisions ?? {}).length,
          activeGrantsCount: getActiveGrantCount(runtime, ctx.sessionManager),
        });
        if (ctx.hasUI) {
          ctx.ui.notify(`pi-guard: ${summary}`, "info");
        } else {
          console.log(summary);
        }
        return;
      }

      if (sub === "" || sub === "settings" || sub === "config") {
        if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
          const config = loadGuardConfig(agentDir, warn);
          const summary = formatGuardStatus({
            mode: session(ctx.sessionManager).mode,
            agentDir,
            trustedRootsCount: (config.trustedRoots ?? []).length,
            savedDecisionsCount: Object.keys(config.decisions ?? {}).length,
            activeGrantsCount: getActiveGrantCount(runtime, ctx.sessionManager),
          });
          if (ctx.hasUI) {
            ctx.ui.notify(
              `Guard settings require TUI mode (${summary})`,
              "info",
            );
          } else {
            console.log(summary);
          }
          return;
        }
        await showGuardSettings({
          ctx,
          agentDir,
          cwd: effectiveCwd(ctx.cwd, ctx.sessionManager),
          currentMode: session(ctx.sessionManager).mode,
          availableModes: modeNames(),
          activeGrantCount: () =>
            getActiveGrantCount(runtime, ctx.sessionManager),
          onModeChange: async (mode) => {
            await switchMode(runtime, ctx, mode);
          },
          onClearGrants: () => {
            const prev = runtime.sessionGrants.get(ctx.sessionManager) ?? [];
            const now = Date.now();
            const activeCount = prev.filter((g) => g.expiresAt > now).length;
            runtime.sessionGrants.delete(ctx.sessionManager);
            publishGuardSnapshot(runtime, ctx.sessionManager);
            return activeCount;
          },
        });
        return;
      }

      if (ctx.hasUI) {
        ctx.ui.notify("Usage: /guard [settings|config|status]", "error");
      }
    },
  });
}
