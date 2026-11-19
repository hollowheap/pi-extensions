import type {
  ExtensionAPI,
  ExtensionContext,
  SessionTreeEvent,
} from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import {
  appendSessionEntry,
  dropSession,
  readLastCustomEntry,
  session,
} from "@hollowheap/core/state";
import {
  type StatuslineEventEmitter,
  type StatuslinePublisher,
  createStatuslinePublisher,
} from "@hollowheap/core/statusline";
import type { DecisionEffect } from "@hollowheap/core/trust";
import { notify } from "@hollowheap/pi-ui/host";
import { restoreApprovalMode } from "./mode.js";

export const AUDIT_TYPE = "hollowheap.guard.audit";

export interface Audit {
  decisionCount: number;
  deniedCount: number;
  approvedTagsCount: number;
  updatedAt?: number;
}

export interface Grant {
  target: string;
  expiresAt: number;
}

export interface EventSink {
  emit(channel: string, data: unknown): void;
}

export interface GuardState {
  sessionDecisions: Map<unknown, Map<string, DecisionEffect>>;
  sessionGrants: Map<unknown, Grant[]>;
  sessionTargets: Map<unknown, Set<string>>;
  sessionApprovedTags: Map<unknown, Map<string, Set<string>>>;
  sessionAudits: Map<unknown, Audit>;
  trustedByOwner: Map<unknown, boolean>;
  statusline?: StatuslinePublisher;
  lastOwner?: unknown;
}

export function createGuardState(
  eventSink?: StatuslineEventEmitter,
): GuardState {
  const state: GuardState = {
    sessionDecisions: new Map(),
    sessionGrants: new Map(),
    sessionTargets: new Map(),
    sessionApprovedTags: new Map(),
    sessionAudits: new Map(),
    trustedByOwner: new Map(),
  };
  if (eventSink !== undefined) {
    state.statusline = createStatuslinePublisher(eventSink, "mode-guard", () =>
      formatModeBadge(session(state.lastOwner).mode),
    );
  }
  return state;
}

export function getOrCreate<K, V>(map: Map<K, V>, key: K, init: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = init();
    map.set(key, value);
  }
  return value;
}

export function createRepublisher(state: GuardState): () => void {
  return () => {
    if (state.lastOwner !== undefined) {
      publishValues(state, state.lastOwner);
    }
  };
}

export function getAudit(state: GuardState, owner: unknown): Audit {
  return getOrCreate(state.sessionAudits, owner, () => ({
    decisionCount: 0,
    deniedCount: 0,
    approvedTagsCount: 0,
  }));
}

export function denyWithAudit(
  pi: ExtensionAPI,
  state: GuardState,
  owner: unknown,
  reason: string,
): { block: true; reason: string } {
  const audit = getAudit(state, owner);
  audit.deniedCount++;
  persistAudit(pi, owner, audit);
  publishSnapshot(state, owner);
  return { block: true, reason };
}

export function persistAudit(
  pi: ExtensionAPI | undefined,
  owner: unknown,
  audit: Audit,
): void {
  const updatedAt = Date.now();
  audit.updatedAt = updatedAt;
  const data = {
    decisionCount: audit.decisionCount,
    deniedCount: audit.deniedCount,
    approvedTagsCount: audit.approvedTagsCount,
    updatedAt,
  };
  appendSessionEntry(pi, owner, AUDIT_TYPE, data);
}

export function publishSnapshot(state: GuardState, owner: unknown): void {
  if (owner === undefined || owner === null) return;
  const audit = getAudit(state, owner);
  const trusted = state.trustedByOwner.get(owner) ?? false;
  const activeGrantCount = getActiveGrantCount(state, owner);
  updateSessionSnapshot(owner, "guard", {
    trusted,
    decisionCount: audit.decisionCount,
    activeGrantCount,
    approvedTagsCount: audit.approvedTagsCount,
    deniedCount: audit.deniedCount,
    updatedAt: audit.updatedAt ?? Date.now(),
  });
}

export function restoreAuditCounters(owner: unknown): Audit {
  const data = readLastCustomEntry(owner, AUDIT_TYPE) as
    | {
        decisionCount?: unknown;
        deniedCount?: unknown;
        approvedTagsCount?: unknown;
        updatedAt?: unknown;
      }
    | undefined;
  if (typeof data !== "object" || data === null) {
    return { decisionCount: 0, deniedCount: 0, approvedTagsCount: 0 };
  }
  return {
    decisionCount:
      typeof data.decisionCount === "number" ? data.decisionCount : 0,
    deniedCount: typeof data.deniedCount === "number" ? data.deniedCount : 0,
    approvedTagsCount:
      typeof data.approvedTagsCount === "number" ? data.approvedTagsCount : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : undefined,
  };
}

export function rememberTarget(
  state: GuardState,
  owner: unknown,
  target: string,
): void {
  if (target === "" || target === ".") return;
  const targets = getOrCreate(state.sessionTargets, owner, () => new Set());
  targets.delete(target);
  targets.add(target);
  while (targets.size > 50) {
    const oldest = targets.values().next().value;
    if (oldest === undefined) break;
    targets.delete(oldest);
  }
}

export function formatModeBadge(mode: string): string {
  return mode.trim().toUpperCase();
}

export function getActiveGrants(
  state: GuardState,
  owner: unknown,
  now = Date.now(),
): Grant[] {
  const grants = state.sessionGrants.get(owner) ?? [];
  return grants.filter((g) => g.expiresAt > now);
}

export function getActiveGrantCount(state: GuardState, owner: unknown): number {
  return getActiveGrants(state, owner).length;
}

export function guardNotify(
  ctx: ExtensionContext,
  message: string,
  level?: "info" | "warning" | "error",
): void {
  if (!ctx.hasUI) return;
  const text = `pi-guard: ${sanitizeTerminalText(message)}`;
  if (level === undefined) notify(ctx, text);
  else notify(ctx, text, level);
}

export function guardWarn(ctx: ExtensionContext): (message: string) => void {
  return (message) => guardNotify(ctx, message, "warning");
}

export function createSessionHandlers(pi: ExtensionAPI, state: GuardState) {
  const restore = (ctx: ExtensionContext) => {
    const trusted = ctx.isProjectTrusted?.() ?? false;
    state.trustedByOwner.set(ctx.sessionManager, trusted);
    const restoredAudit = restoreAuditCounters(ctx.sessionManager);
    state.sessionAudits.set(ctx.sessionManager, restoredAudit);
    restoreApprovalMode(pi, ctx);
    publishValues(state, ctx.sessionManager);
  };

  return {
    restore: (_event: unknown, ctx: ExtensionContext) => restore(ctx),
    tree: (_event: SessionTreeEvent, ctx: ExtensionContext) => restore(ctx),
    compact: (_event: unknown, ctx?: ExtensionContext) => {
      const owner = ctx?.sessionManager ?? state.lastOwner;
      if (!owner) return;
      const audit = state.sessionAudits.get(owner);
      if (
        audit &&
        (audit.decisionCount > 0 ||
          audit.deniedCount > 0 ||
          audit.approvedTagsCount > 0)
      ) {
        persistAudit(pi, owner, audit);
      }
    },
    shutdown: (_event: unknown, ctx: ExtensionContext) => {
      state.statusline?.publish("");
      state.sessionDecisions.delete(ctx.sessionManager);
      state.sessionGrants.delete(ctx.sessionManager);
      state.sessionTargets.delete(ctx.sessionManager);
      state.sessionApprovedTags.delete(ctx.sessionManager);
      state.sessionAudits.delete(ctx.sessionManager);
      state.trustedByOwner.delete(ctx.sessionManager);
      dropSession(ctx.sessionManager);
    },
  };
}

export function publishValues(state: GuardState, owner: unknown): void {
  state.lastOwner = owner;
  if (owner !== undefined && owner !== null) {
    updateSessionSnapshot(owner, "mode", {
      name: session(owner).mode,
      updatedAt: Date.now(),
    });
    publishSnapshot(state, owner);
  }
  state.statusline?.publish(formatModeBadge(session(owner).mode));
}
