import { isAbsolute } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
  ToolResultEvent,
  ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadPermissions, loadToolTags } from "@hollowheap/core/config";
import {
  displayTarget,
  errorMessage,
  sanitizeTerminalText,
  truncateText,
} from "@hollowheap/core/format";
import { type EvaluateOptions, evaluateDetailed } from "@hollowheap/core/modes";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { resolveScopedPath } from "@hollowheap/core/scope";
import { effectiveCwd, session } from "@hollowheap/core/state";
import { checkPathTrust } from "@hollowheap/core/trust";
import type { Tag } from "@hollowheap/core/types";
import { confirmDialog, notify } from "@hollowheap/pi-ui/host";
import {
  TOOL_TAGS,
  isPassthroughTaskCall,
  readCommandArg,
  readToolTarget,
} from "@hollowheap/policy";
import { classifyToolCall } from "./classifier.js";
import { loadConfig } from "./settings.js";
import {
  type GuardState,
  denyWithAudit,
  getAudit,
  guardWarn,
  persistAudit,
  publishSnapshot,
  rememberTarget,
} from "./state.js";
import { handleOutsideWorkspaceTrust } from "./trust.js";

export function loadContextPermissions(ctx: ExtensionContext) {
  return loadPermissions({
    agentDir: getAgentDir(),
    workspaceRoot: ctx.cwd,
    trusted: ctx.isProjectTrusted(),
    onDiagnostic: guardWarn(ctx),
  });
}

export function loadContextToolTags(ctx: ExtensionContext) {
  return loadToolTags({
    agentDir: getAgentDir(),
    workspaceRoot: ctx.cwd,
    trusted: ctx.isProjectTrusted(),
    onDiagnostic: guardWarn(ctx),
  });
}

export async function requestApproval(
  state: GuardState,
  toolName: string,
  target: string,
  ctx: ExtensionContext,
  pi?: ExtensionAPI,
): Promise<{ block: true; reason: string } | undefined> {
  const audit = getAudit(state, ctx.sessionManager);
  if (!ctx.hasUI) {
    audit.deniedCount++;
    persistAudit(pi, ctx.sessionManager, audit);
    publishSnapshot(state, ctx.sessionManager);
    return {
      block: true,
      reason: `pi-guard: ${toolName} ${displayTarget(target)} needs approval (no UI)`,
    };
  }
  const sanitizedTarget = sanitizeTerminalText(target);
  const approved = await withPromptLock(() =>
    confirmDialog(ctx, `Allow ${toolName}?`, sanitizedTarget, {
      signal: (ctx as { signal?: AbortSignal }).signal,
    }),
  );
  audit.decisionCount++;
  if (!approved) {
    audit.deniedCount++;
    persistAudit(pi, ctx.sessionManager, audit);
    publishSnapshot(state, ctx.sessionManager);
    return {
      block: true,
      reason: `pi-guard: ${toolName} ${displayTarget(target)} was not approved`,
    };
  }
  persistAudit(pi, ctx.sessionManager, audit);
  publishSnapshot(state, ctx.sessionManager);
  return undefined;
}

function resolveRelativeInputPath(input: unknown, ctx: ExtensionContext): void {
  if (effectiveCwd(ctx.cwd, ctx.sessionManager) === ctx.cwd) return;
  const record = input as Record<string, unknown>;
  if (
    typeof record.path === "string" &&
    record.path !== "" &&
    !isAbsolute(record.path)
  ) {
    record.path = resolveScopedPath(ctx.cwd, record.path, ctx.sessionManager);
  }
}

function formatDeniedReason(tag: Tag, target: string, detail?: string): string {
  const base = `pi-guard: ${tag} access to ${displayTarget(target)} is denied`;
  return detail ? `${base} (${sanitizeTerminalText(detail)})` : base;
}

function evaluateActiveGrant(
  pi: ExtensionAPI,
  state: GuardState,
  ctx: ExtensionContext,
  tag: Tag,
  target: string,
  canonicalPath: string,
  decisionOptions: Pick<
    EvaluateOptions,
    "trustedRoots" | "sessionDecisions" | "persistentDecisions"
  >,
): { matched: boolean; result?: { block: true; reason: string } } {
  const grants = state.sessionGrants.get(ctx.sessionManager) ?? [];
  const now = Date.now();
  const activeGrant = grants.find(
    (grant) => grant.target === target && grant.expiresAt > now,
  );
  if (!activeGrant) return { matched: false };

  const { verdict, reason } = evaluateDetailed({
    owner: ctx.sessionManager,
    cwd: ctx.cwd,
    tag,
    target,
    rules: [],
    ...decisionOptions,
    ...(tag !== "shell"
      ? {
          trustedRoots: [
            ...(decisionOptions.trustedRoots ?? []),
            canonicalPath,
          ],
        }
      : {}),
  });
  if (verdict === "deny") {
    return {
      matched: true,
      result: denyWithAudit(
        pi,
        state,
        ctx.sessionManager,
        formatDeniedReason(tag, target, reason),
      ),
    };
  }
  return { matched: true };
}

async function handleToolCall(
  pi: ExtensionAPI,
  state: GuardState,
  event: ToolCallEvent,
  ctx: ExtensionContext,
) {
  if (isPassthroughTaskCall(event.toolName, event.input)) {
    return undefined;
  }
  const builtinTag = Object.hasOwn(TOOL_TAGS, event.toolName)
    ? TOOL_TAGS[event.toolName]
    : undefined;
  const userTags =
    builtinTag === undefined ? loadContextToolTags(ctx) : undefined;
  const tag: Tag | undefined =
    builtinTag ??
    (userTags !== undefined && Object.hasOwn(userTags, event.toolName)
      ? userTags[event.toolName]
      : undefined);

  const classifierVerdict = await classifyToolCall(event, tag, ctx);
  if (classifierVerdict?.kind === "block") {
    return denyWithAudit(
      pi,
      state,
      ctx.sessionManager,
      `pi-guard: classifier blocked ${sanitizeTerminalText(event.toolName)}`,
    );
  }
  if (classifierVerdict?.kind === "error") {
    const detail = sanitizeTerminalText(classifierVerdict.detail);
    const message = `pi-guard: classifier failure (${detail}); continuing with standard guard evaluation (fail-open)`;
    const auditSink = (ctx as { audit?: { warn?: (message: string) => void } })
      .audit;
    auditSink?.warn?.(message);
    if (ctx.hasUI) notify(ctx, message, "warning");
    pi.events?.emit?.("guard:classifier-error", {
      detail: classifierVerdict.detail,
      tool: event.toolName,
    });
  }

  if (tag === undefined) {
    if (session(ctx.sessionManager).mode === "auto") {
      return undefined;
    }
    const hints = pi
      .getAllTools?.()
      .find((tool) => tool.name === event.toolName)?.annotations;
    if (hints?.readOnlyHint === true && hints.destructiveHint !== true) {
      return undefined;
    }
    const raw = readToolTarget(event.toolName, event.input) ?? ".";
    return requestApproval(state, event.toolName, raw, ctx, pi);
  }
  const pathTagged = tag !== "shell" && tag !== "external";
  if (pathTagged) {
    resolveRelativeInputPath(event.input, ctx);
  }
  const target =
    tag === "shell"
      ? readCommandArg(event.input)
      : (readToolTarget(event.toolName, event.input) ?? ".");
  rememberTarget(state, ctx.sessionManager, target);

  const agentDir = getAgentDir();
  const guardConfig = loadConfig(agentDir, guardWarn(ctx));
  const configuredRoots = guardConfig.trustedRoots ?? [];
  // A scoped root applies only to the tool tag being evaluated, so fold it
  // into the path list for the current tag before trust and policy checks.
  const decisionRoots = configuredRoots.flatMap((root) =>
    typeof root === "string"
      ? [root]
      : root.tags.includes(tag)
        ? [root.path]
        : [],
  );
  const sessionMap = state.sessionDecisions.get(ctx.sessionManager);
  const decisionOptions: Pick<
    EvaluateOptions,
    "trustedRoots" | "sessionDecisions" | "persistentDecisions"
  > = {
    trustedRoots: decisionRoots,
    sessionDecisions: sessionMap,
    persistentDecisions: guardConfig.decisions,
  };
  const trust = pathTagged
    ? checkPathTrust(
        target,
        ctx.cwd,
        decisionRoots,
        sessionMap,
        guardConfig.decisions,
      )
    : undefined;

  const grantResult = evaluateActiveGrant(
    pi,
    state,
    ctx,
    tag,
    target,
    trust?.canonicalPath ?? "",
    decisionOptions,
  );
  if (grantResult.matched) return grantResult.result;

  if (pathTagged && trust?.isOutsideWorkspace) {
    return handleOutsideWorkspaceTrust({
      pi,
      state,
      ctx,
      agentDir,
      tag,
      toolName: event.toolName,
      target,
      trust,
      configuredRoots,
      decisionOptions,
    });
  }

  const { verdict, reason } = evaluateDetailed({
    owner: ctx.sessionManager,
    cwd: ctx.cwd,
    tag,
    target,
    rules: loadContextPermissions(ctx),
    ...decisionOptions,
  });
  if (verdict === "deny") {
    return denyWithAudit(
      pi,
      state,
      ctx.sessionManager,
      formatDeniedReason(tag, target, reason),
    );
  }
  if (verdict === "ask")
    return requestApproval(state, event.toolName, target, ctx, pi);
  return undefined;
}

export function createToolHandlers(pi: ExtensionAPI, state: GuardState) {
  return {
    toolCall: async (event: ToolCallEvent, ctx: ExtensionContext) => {
      try {
        state.trustedByOwner.set(
          ctx.sessionManager,
          ctx.isProjectTrusted?.() ?? false,
        );
        return await handleToolCall(pi, state, event, ctx);
      } catch (error) {
        return denyWithAudit(
          pi,
          state,
          ctx.sessionManager,
          `pi-guard: tool call check failed (${sanitizeTerminalText(errorMessage(error))})`,
        );
      }
    },
    toolResult: (event: ToolResultEvent): ToolResultEventResult | undefined => {
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
      return changed ? { content } : undefined;
    },
  };
}
