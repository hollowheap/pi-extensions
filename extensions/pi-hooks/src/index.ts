import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { truncateText } from "@hollowheap/core/format";
import { effectiveCwd, session } from "@hollowheap/core/state";
import { type HookConfig, clearHooksCache, loadHooks } from "./config.js";
import {
  type HookPayload,
  type SessionHookPayload,
  evaluateCondition,
  matchesTool,
  runPostHook,
  runPreHook,
  runSessionHook,
} from "./hooks.js";

// The skill sits outside the package's conventional "skills" root so that pi
// never discovers it twice: only this extension contributes it.
const SKILL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "skills",
  "hooks-init",
  "SKILL.md",
);

const diagnosticCallbacks = new WeakMap<object, (message: string) => void>();

function loadContextHooks(ctx: ExtensionContext): HookConfig {
  const owner: object = ctx.sessionManager ?? ctx;
  let onDiagnostic = diagnosticCallbacks.get(owner);
  if (onDiagnostic === undefined) {
    onDiagnostic = (message) => notifyWarning(ctx, `pi-hooks: ${message}`);
    diagnosticCallbacks.set(owner, onDiagnostic);
  }
  return loadHooks({
    agentDir: getAgentDir(),
    workspaceRoot: ctx.cwd,
    trusted: ctx.isProjectTrusted(),
    onDiagnostic,
  });
}

function inputRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return value === undefined ? {} : { value };
}

function payloadFor(
  ctx: ExtensionContext,
  event: { toolName: string; toolCallId: string; input: unknown },
  kind: HookPayload["event"],
): HookPayload {
  return {
    event: kind,
    toolName: event.toolName,
    toolCallId: event.toolCallId,
    input: inputRecord(event.input),
    cwd: effectiveCwd(ctx.cwd, ctx.sessionManager),
    mode: session(ctx.sessionManager).mode,
  };
}

function notifyWarning(ctx: ExtensionContext, message: string): void {
  try {
    ctx.ui.notify(message, "warning");
  } catch {
    // Hooks must continue even when the UI is unavailable.
  }
}

export default function (pi: ExtensionAPI) {
  if (process.env.PI_HOOKS_DISCOVER_SKILL === "1") {
    pi.on("resources_discover", () => ({ skillPaths: [SKILL_PATH] }));
  }
  pi.on("session_start", async (_event, ctx) => {
    try {
      const hooks = loadContextHooks(ctx).sessionStart;
      if (hooks.length === 0) return;
      const payload: SessionHookPayload = {
        event: "session_start",
        cwd: effectiveCwd(ctx.cwd, ctx.sessionManager),
        mode: session(ctx.sessionManager).mode,
      };
      for (const hook of hooks) {
        const result = await runSessionHook(hook, payload);
        if (result.error !== undefined) {
          notifyWarning(
            ctx,
            `pi-hooks: ${hook.command} failed: ${result.error}`,
          );
        }
      }
    } catch (error) {
      notifyWarning(
        ctx,
        `pi-hooks: session hooks failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  pi.on("tool_call", async (event, ctx) => {
    try {
      const payload = payloadFor(ctx, event, "pre_tool");
      const hooks = loadContextHooks(ctx).preTool.filter(
        (hook) =>
          matchesTool(hook, event.toolName) && evaluateCondition(hook, payload),
      );
      if (hooks.length === 0) return undefined;
      for (const hook of hooks) {
        const verdict = await runPreHook(hook, payload);
        if (verdict.block) {
          return { block: true, reason: `pi-hooks: ${verdict.reason}` };
        }
      }
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notifyWarning(ctx, `pi-hooks: pre-tool hooks failed: ${message}`);
      return {
        block: true,
        reason: `pi-hooks: pre-tool hooks failed: ${message}`,
      };
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    try {
      const payload = payloadFor(ctx, event, "post_tool");
      const hooks = loadContextHooks(ctx).postTool.filter(
        (hook) =>
          matchesTool(hook, event.toolName) && evaluateCondition(hook, payload),
      );
      if (hooks.length === 0) return undefined;
      const notes: string[] = [];
      let previousOutput = "";
      for (const hook of hooks) {
        const hookPayload = hook.chain
          ? { ...payload, input: { ...payload.input, previousOutput } }
          : payload;
        const result = await runPostHook(hook, hookPayload);
        if (result.error !== undefined) {
          notifyWarning(
            ctx,
            `pi-hooks: ${hook.command} failed: ${result.error}`,
          );
          previousOutput = "";
          continue;
        }
        previousOutput = result.output ?? "";
        if (result.output !== undefined) {
          notes.push(
            `[pi-hooks: ${hook.command}]\n${truncateText(result.output, "pi-hooks")}`,
          );
        }
      }
      if (notes.length === 0) return undefined;
      return {
        content: [
          ...event.content,
          ...notes.map((text) => ({ type: "text" as const, text })),
        ],
        ...(event.structuredContent === undefined
          ? {}
          : { structuredContent: event.structuredContent }),
      };
    } catch (error) {
      notifyWarning(
        ctx,
        `pi-hooks: post-tool hooks failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  });
  pi.on("session_shutdown", () => {
    clearHooksCache();
  });
}
