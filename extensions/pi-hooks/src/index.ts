import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { effectiveCwd, session, truncateText } from "@hollowheap/core";
import { type HookConfig, loadHooks } from "./config.js";
import {
  type HookPayload,
  type SessionHookPayload,
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

function loadContextHooks(ctx: ExtensionContext): HookConfig {
  return loadHooks({
    agentDir: getAgentDir(),
    workspaceRoot: ctx.cwd,
    trusted: ctx.isProjectTrusted(),
    onDiagnostic: (message) => ctx.ui.notify(`pi-hooks: ${message}`, "warning"),
  });
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
    input: event.input as Record<string, unknown>,
    cwd: effectiveCwd(ctx.cwd, ctx.sessionManager),
    mode: session(ctx.sessionManager).mode,
  };
}

function notifySessionWarning(ctx: ExtensionContext, message: string): void {
  try {
    ctx.ui.notify(message, "warning");
  } catch {
    // Startup must continue even when the UI is unavailable.
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
          notifySessionWarning(
            ctx,
            `pi-hooks: ${hook.command} failed: ${result.error}`,
          );
        }
      }
    } catch (error) {
      notifySessionWarning(
        ctx,
        `pi-hooks: session hooks failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  pi.on("tool_call", async (event, ctx) => {
    const hooks = loadContextHooks(ctx).preTool.filter((hook) =>
      matchesTool(hook, event.toolName),
    );
    if (hooks.length === 0) return undefined;
    const payload = payloadFor(ctx, event, "pre_tool");
    for (const hook of hooks) {
      const verdict = await runPreHook(hook, payload);
      if (verdict.block) {
        return { block: true, reason: `pi-hooks: ${verdict.reason}` };
      }
    }
    return undefined;
  });

  pi.on("tool_result", async (event, ctx) => {
    const hooks = loadContextHooks(ctx).postTool.filter((hook) =>
      matchesTool(hook, event.toolName),
    );
    if (hooks.length === 0) return undefined;
    const payload = payloadFor(ctx, event, "post_tool");
    const notes: string[] = [];
    for (const hook of hooks) {
      const result = await runPostHook(hook, payload);
      if (result.error !== undefined) {
        ctx.ui.notify(
          `pi-hooks: ${hook.command} failed: ${result.error}`,
          "warning",
        );
        continue;
      }
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
  });
}
