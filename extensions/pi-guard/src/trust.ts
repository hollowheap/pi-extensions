import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { displayTarget } from "@hollowheap/core/format";
import { type EvaluateOptions, evaluate } from "@hollowheap/core/modes";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { session } from "@hollowheap/core/state";
import {
  type DecisionEffect,
  type PathTrustVerdict,
  type PersistenceScope,
  type TrustedRoot,
  isSubpath,
  persistGuardDecision,
} from "@hollowheap/core/trust";
import type { Tag } from "@hollowheap/core/types";
import { hostUi, notify, selectDialog } from "@hollowheap/pi-ui/host";
import { loadContextPermissions, requestApproval } from "./decisions.js";
import { hasTrustedRoots, rootPath } from "./settings.js";
import {
  type GuardState,
  denyWithAudit,
  getAudit,
  getOrCreate,
  persistAudit,
  publishSnapshot,
} from "./state.js";

const PROMPT_CHOICES: Record<
  string,
  { effect: DecisionEffect; scope: PersistenceScope }
> = {
  "Allow (this session)": { effect: "allow", scope: "session" },
  "Allow indefinitely": { effect: "allow", scope: "indefinite" },
  "Ask (this session)": { effect: "ask", scope: "session" },
  "Deny (this session)": { effect: "deny", scope: "session" },
  "Deny indefinitely": { effect: "deny", scope: "indefinite" },
};

export interface OutsideWorkspaceTrustOptions {
  pi: ExtensionAPI;
  state: GuardState;
  ctx: ExtensionContext;
  agentDir: string;
  tag: Tag;
  toolName: string;
  target: string;
  trust: PathTrustVerdict;
  configuredRoots: readonly TrustedRoot[];
  decisionOptions: Pick<
    EvaluateOptions,
    "trustedRoots" | "sessionDecisions" | "persistentDecisions"
  >;
}

function evaluateTrustedOutsidePath(options: OutsideWorkspaceTrustOptions): {
  handled: boolean;
  result?: { block: true; reason: string };
} {
  const { pi, state, ctx, tag, target, trust, decisionOptions } = options;
  if (
    session(ctx.sessionManager).mode === "plan" &&
    (tag === "edit" || tag === "write")
  ) {
    return {
      handled: true,
      result: denyWithAudit(
        pi,
        state,
        ctx.sessionManager,
        `pi-guard: ${tag} access to ${displayTarget(target)} is denied (plan mode)`,
      ),
    };
  }
  const approvedTags = state.sessionApprovedTags
    .get(ctx.sessionManager)
    ?.get(trust.canonicalPath);
  const needsWriteUpgrade =
    (tag === "edit" || tag === "write") &&
    approvedTags !== undefined &&
    !approvedTags.has(tag) &&
    !approvedTags.has("write") &&
    !approvedTags.has("edit");
  if (needsWriteUpgrade) {
    // Read approval never allows edit or write; proceed to ask dialog.
    return { handled: false };
  }
  const verdict = evaluate({
    owner: ctx.sessionManager,
    cwd: ctx.cwd,
    tag,
    target,
    rules: loadContextPermissions(ctx),
    ...decisionOptions,
  });
  if (verdict === "deny") {
    return {
      handled: true,
      result: denyWithAudit(
        pi,
        state,
        ctx.sessionManager,
        `pi-guard: ${tag} access to ${displayTarget(target)} is denied`,
      ),
    };
  }
  return { handled: true };
}

/**
 * Evaluates and prompts for out-of-workspace path access.
 */
export async function handleOutsideWorkspaceTrust(
  options: OutsideWorkspaceTrustOptions,
): Promise<{ block: true; reason: string } | undefined> {
  const {
    pi,
    state,
    ctx,
    agentDir,
    tag,
    toolName,
    target,
    trust,
    configuredRoots,
  } = options;

  if (trust.cachedDecision === "deny") {
    return denyWithAudit(
      pi,
      state,
      ctx.sessionManager,
      `pi-guard: ${tag} access to ${displayTarget(target)} is denied`,
    );
  }
  if (trust.cachedDecision === "ask") {
    return requestApproval(state, toolName, target, ctx, pi);
  }

  const agentRootActive =
    !hasTrustedRoots(agentDir) ||
    configuredRoots.some(
      (root) =>
        (typeof root === "string" || root.tags.includes(tag)) &&
        isSubpath(rootPath(root), agentDir, ctx.cwd),
    );
  if (
    (tag === "read" || tag === "search") &&
    agentRootActive &&
    isSubpath(agentDir, trust.canonicalPath)
  ) {
    return undefined;
  }

  if (trust.isTrusted) {
    const trustedResult = evaluateTrustedOutsidePath(options);
    if (trustedResult.handled) return trustedResult.result;
  }

  if (!ctx.hasUI || typeof hostUi(ctx).select !== "function") {
    return denyWithAudit(
      pi,
      state,
      ctx.sessionManager,
      `pi-guard: ${tag} access to out-of-workspace ${displayTarget(target)} is denied (no UI)`,
    );
  }

  const choice = await withPromptLock(() =>
    selectDialog(
      ctx,
      `Allow access to out-of-workspace path ${displayTarget(target)}?`,
      Object.keys(PROMPT_CHOICES),
      { signal: (ctx as { signal?: AbortSignal }).signal },
    ),
  );

  const selected =
    choice !== undefined && Object.hasOwn(PROMPT_CHOICES, choice)
      ? PROMPT_CHOICES[choice]
      : undefined;
  if (selected === undefined) {
    return denyWithAudit(
      pi,
      state,
      ctx.sessionManager,
      `pi-guard: ${tag} access to out-of-workspace ${displayTarget(target)} is denied (not approved)`,
    );
  }

  const audit = getAudit(state, ctx.sessionManager);
  if (selected.effect !== "ask") audit.decisionCount++;

  const currentSessionMap = getOrCreate(
    state.sessionDecisions,
    ctx.sessionManager,
    () => new Map(),
  );

  if (selected.effect === "allow") {
    const currentApprovedTags = getOrCreate(
      state.sessionApprovedTags,
      ctx.sessionManager,
      () => new Map(),
    );
    const tags = getOrCreate(
      currentApprovedTags,
      trust.canonicalPath,
      () => new Set(),
    );
    if (!tags.has(tag)) {
      tags.add(tag);
      audit.approvedTagsCount++;
    }
  }

  if (selected.effect === "deny") {
    audit.deniedCount++;
  }
  persistAudit(pi, ctx.sessionManager, audit);
  publishSnapshot(state, ctx.sessionManager);
  persistGuardDecision(
    agentDir,
    trust.canonicalPath,
    selected.effect,
    selected.scope,
    currentSessionMap,
    (msg, t) => notify(ctx, msg, t),
  );

  if (selected.effect === "ask") {
    return requestApproval(state, toolName, target, ctx, pi);
  }
  if (selected.effect === "deny") {
    return {
      block: true,
      reason: `pi-guard: ${tag} access to ${displayTarget(target)} is denied`,
    };
  }
  if (
    session(ctx.sessionManager).mode === "plan" &&
    (tag === "edit" || tag === "write")
  ) {
    return {
      block: true,
      reason: `pi-guard: ${tag} access to ${displayTarget(target)} is denied (plan mode)`,
    };
  }
  return undefined;
}
