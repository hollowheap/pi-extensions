import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadPermissions, loadToolTags } from "@hollowheap/core/config";
import { errorMessage } from "@hollowheap/core/format";
import { displayTarget } from "@hollowheap/core/format";
import { evaluate, registerMode } from "@hollowheap/core/modes";
import { resolveScopedPath } from "@hollowheap/core/scope";
import { loadGuardTrust } from "@hollowheap/core/trust";
import { BUILTIN_MODE_LAYERS } from "./modes.js";
import {
  TOOL_TAGS,
  isPassthroughTaskCall,
  readCommandArg,
  readToolTarget,
} from "./targets.js";

function notifyDiagnostic(ctx: ExtensionContext) {
  if (typeof ctx.ui?.notify !== "function") return undefined;
  return (message: string) => {
    ctx.ui.notify(`pi-policy: ${message}`, "warning");
  };
}

function rulesFor(ctx: ExtensionContext) {
  return loadPermissions({
    agentDir: getAgentDir(),
    workspaceRoot: ctx.cwd,
    trusted: ctx.isProjectTrusted(),
    onDiagnostic: notifyDiagnostic(ctx),
  });
}

function tagsFor(ctx: ExtensionContext) {
  return loadToolTags({
    agentDir: getAgentDir(),
    workspaceRoot: ctx.cwd,
    trusted: ctx.isProjectTrusted(),
    onDiagnostic: notifyDiagnostic(ctx),
  });
}

function handleToolCall(
  event: ToolCallEvent,
  ctx: ExtensionContext,
): { block: true; reason: string } | undefined {
  if (isPassthroughTaskCall(event.toolName, event.input)) {
    return undefined;
  }
  const builtinTag = Object.hasOwn(TOOL_TAGS, event.toolName)
    ? TOOL_TAGS[event.toolName]
    : undefined;
  const userTags = tagsFor(ctx);
  const tag =
    builtinTag ??
    (Object.hasOwn(userTags, event.toolName)
      ? userTags[event.toolName]
      : undefined);
  if (tag === undefined) {
    return {
      block: true,
      reason: `pi-policy: ${event.toolName} has no permission category`,
    };
  }

  const rawTarget =
    tag === "shell"
      ? readCommandArg(event.input)
      : (readToolTarget(event.toolName, event.input) ?? ".");
  const target =
    tag !== "shell" && tag !== "external"
      ? resolveScopedPath(ctx.cwd, rawTarget, ctx.sessionManager)
      : rawTarget;

  const trust = loadGuardTrust(getAgentDir(), notifyDiagnostic(ctx));
  const verdict = evaluate({
    owner: ctx.sessionManager,
    cwd: ctx.cwd,
    tag,
    target,
    rules: rulesFor(ctx),
    trustedRoots: trust.trustedRoots,
    persistentDecisions: trust.persistentDecisions,
  });

  if (verdict === "deny") {
    return {
      block: true,
      reason: `pi-policy: ${tag} access to ${displayTarget(target)} is denied`,
    };
  }
  if (verdict === "ask") {
    return {
      block: true,
      reason: `pi-policy: ${event.toolName} ${displayTarget(target)} needs approval (no UI)`,
    };
  }
  return undefined;
}

export default function (pi: ExtensionAPI): void {
  for (const layer of BUILTIN_MODE_LAYERS) {
    registerMode(layer);
  }
  pi.on("tool_call", (event, ctx) => {
    try {
      return Promise.resolve(handleToolCall(event, ctx));
    } catch (error) {
      const message = errorMessage(error);
      return Promise.resolve({
        block: true,
        reason: `pi-policy: tool call check failed: ${message}`,
      });
    }
  });
}
