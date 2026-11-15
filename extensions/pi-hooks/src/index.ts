import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { isPermissionError } from "@hollowheap/core/config";
import { truncateText } from "@hollowheap/core/format";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { effectiveCwd, session } from "@hollowheap/core/state";
import {
  isOsPermissionError,
  probeBwrapAvailability,
} from "@hollowheap/runtime/sandbox";
import {
  type HookConfig,
  type HooksSettings,
  clearHooksCache,
  isHookSandboxEnabled,
  isHookSandboxOffline,
  loadAgentHooksConfig,
  loadHooks,
  saveHooksSettings,
} from "./config.js";
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
    onDiagnostic = (message) =>
      notifyMessage(
        ctx,
        `pi-hooks: ${message}`,
        isPermissionError(message) ? "error" : "warning",
      );
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

function notifyMessage(
  ctx: ExtensionContext,
  message: string,
  level: "info" | "warning" | "error" = "warning",
): void {
  try {
    ctx.ui.notify(message, level);
  } catch {
    // Hooks must continue even when the UI is unavailable.
  }
}

function notifyWarning(ctx: ExtensionContext, message: string): void {
  notifyMessage(ctx, message, "warning");
}

function isAnyPermissionFailure(detail: string): boolean {
  return isPermissionError(detail) || isOsPermissionError(detail);
}

export const HOOK_STATS_TYPE = "hollowheap.hooks";

interface HooksSessionState {
  runs: number;
  blocks: number;
  errors: number;
  updatedAt: number;
}

const hooksStates = new WeakMap<object, HooksSessionState>();
const fallbackHooksState: HooksSessionState = {
  runs: 0,
  blocks: 0,
  errors: 0,
  updatedAt: 0,
};

function getHooksSessionState(owner?: unknown): HooksSessionState {
  if (typeof owner === "object" && owner !== null) {
    let state = hooksStates.get(owner);
    if (state === undefined) {
      state = { runs: 0, blocks: 0, errors: 0, updatedAt: 0 };
      hooksStates.set(owner, state);
    }
    return state;
  }
  return fallbackHooksState;
}

function publishHooksSnapshot(
  ctx: ExtensionContext,
  config?: HookConfig,
): void {
  try {
    let cfg = config;
    if (cfg === undefined) {
      try {
        cfg = loadContextHooks(ctx);
      } catch {
        cfg = {
          sessionStart: [],
          preTool: [],
          postTool: [],
        };
      }
    }
    const state = getHooksSessionState(ctx.sessionManager);
    if (ctx.sessionManager) {
      updateSessionSnapshot(ctx.sessionManager, "hooks", {
        sessionStartCount: cfg.sessionStart.length,
        preToolCount: cfg.preTool.length,
        postToolCount: cfg.postTool.length,
        runs: state.runs,
        blocks: state.blocks,
        errors: state.errors,
        updatedAt: state.updatedAt,
      });
    }
  } catch {
    // Snapshot updates must never throw
  }
}

function recordHookEvent(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  event: { run?: boolean; block?: boolean; error?: boolean },
  config?: HookConfig,
): void {
  const state = getHooksSessionState(ctx.sessionManager);
  let shouldPersist = false;
  if (event.run) state.runs += 1;
  if (event.block) {
    state.blocks += 1;
    shouldPersist = true;
  }
  if (event.error) {
    state.errors += 1;
    shouldPersist = true;
  }
  state.updatedAt = Date.now();
  if (shouldPersist) {
    pi?.appendEntry?.(HOOK_STATS_TYPE, {
      runs: state.runs,
      blocks: state.blocks,
      errors: state.errors,
      updatedAt: state.updatedAt,
    });
  }
  publishHooksSnapshot(ctx, config);
}

export default function (pi: ExtensionAPI) {
  let lastCtx: ExtensionContext | undefined;

  const restoreHooksSession = (ctx: ExtensionContext) => {
    lastCtx = ctx;
    const entries =
      (typeof ctx.sessionManager?.getBranch === "function"
        ? ctx.sessionManager.getBranch()
        : typeof ctx.sessionManager?.getEntries === "function"
          ? ctx.sessionManager.getEntries()
          : []) ?? [];
    let lastData:
      | {
          runs?: number;
          blocks?: number;
          errors?: number;
          updatedAt?: number;
        }
      | undefined;
    for (const entry of entries) {
      const raw = entry as {
        type?: string;
        customType?: string;
        data?: unknown;
      };
      if (
        (raw.type === "custom" && raw.customType === HOOK_STATS_TYPE) ||
        raw.type === HOOK_STATS_TYPE
      ) {
        if (typeof raw.data === "object" && raw.data !== null) {
          lastData = raw.data as typeof lastData;
        }
      }
    }
    const state = getHooksSessionState(ctx.sessionManager);
    if (lastData) {
      state.runs = typeof lastData.runs === "number" ? lastData.runs : 0;
      state.blocks = typeof lastData.blocks === "number" ? lastData.blocks : 0;
      state.errors = typeof lastData.errors === "number" ? lastData.errors : 0;
      state.updatedAt =
        typeof lastData.updatedAt === "number"
          ? lastData.updatedAt
          : Date.now();
    }
    publishHooksSnapshot(ctx);
  };

  if (process.env.PI_HOOKS_DISCOVER_SKILL === "1") {
    pi.on("resources_discover", () => ({ skillPaths: [SKILL_PATH] }));
  }

  pi.on("session_start", async (_event, ctx) => {
    restoreHooksSession(ctx);
    try {
      const config = loadContextHooks(ctx);
      const hooks = config.sessionStart;
      if (hooks.length === 0) return;
      const payload: SessionHookPayload = {
        event: "session_start",
        cwd: effectiveCwd(ctx.cwd, ctx.sessionManager),
        mode: session(ctx.sessionManager).mode,
      };
      for (const hook of hooks) {
        const result = await runSessionHook(hook, payload, config.sandbox);
        if (result.error !== undefined) {
          recordHookEvent(pi, ctx, { run: true, error: true }, config);
          notifyMessage(
            ctx,
            `pi-hooks: ${hook.command} failed: ${result.error}`,
            isAnyPermissionFailure(result.error) ? "error" : "warning",
          );
        } else {
          recordHookEvent(pi, ctx, { run: true }, config);
        }
      }
    } catch (error) {
      recordHookEvent(pi, ctx, { error: true });
      notifyWarning(
        ctx,
        `pi-hooks: session hooks failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  pi.on("session_tree", (_event, ctx) => {
    restoreHooksSession(ctx);
  });

  pi.on("session_compact", (_event, ctx) => {
    const owner = ctx?.sessionManager ?? lastCtx?.sessionManager;
    const state = getHooksSessionState(owner);
    if (state.runs > 0) {
      pi?.appendEntry?.(HOOK_STATS_TYPE, {
        runs: state.runs,
        blocks: state.blocks,
        errors: state.errors,
        updatedAt: Date.now(),
      });
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    lastCtx = ctx;
    try {
      const config = loadContextHooks(ctx);
      const payload = payloadFor(ctx, event, "pre_tool");
      const hooks = config.preTool.filter(
        (hook) =>
          matchesTool(hook, event.toolName) && evaluateCondition(hook, payload),
      );
      if (hooks.length === 0) return undefined;
      for (const hook of hooks) {
        const verdict = await runPreHook(hook, payload, config.sandbox);
        if (verdict.block) {
          recordHookEvent(pi, ctx, { run: true, block: true }, config);
          if (verdict.reason && isAnyPermissionFailure(verdict.reason)) {
            notifyMessage(ctx, `pi-hooks: ${verdict.reason}`, "error");
          }
          return { block: true, reason: `pi-hooks: ${verdict.reason}` };
        }
        recordHookEvent(pi, ctx, { run: true }, config);
      }
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordHookEvent(pi, ctx, { error: true, block: true });
      notifyWarning(ctx, `pi-hooks: pre-tool hooks failed: ${message}`);
      return {
        block: true,
        reason: `pi-hooks: pre-tool hooks failed: ${message}`,
      };
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    lastCtx = ctx;
    try {
      const config = loadContextHooks(ctx);
      const payload = payloadFor(ctx, event, "post_tool");
      const hooks = config.postTool.filter(
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
        const result = await runPostHook(hook, hookPayload, config.sandbox);
        if (result.error !== undefined) {
          recordHookEvent(pi, ctx, { run: true, error: true }, config);
          notifyMessage(
            ctx,
            `pi-hooks: ${hook.command} failed: ${result.error}`,
            isAnyPermissionFailure(result.error) ? "error" : "warning",
          );
          previousOutput = "";
          continue;
        }
        recordHookEvent(pi, ctx, { run: true }, config);
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
      recordHookEvent(pi, ctx, { error: true });
      notifyWarning(
        ctx,
        `pi-hooks: post-tool hooks failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  });
  pi.registerCommand("hooks", {
    description: "Manage hooks: /hooks [settings|config|status]",
    getArgumentCompletions: (prefix: string) => {
      const parts = prefix.trimStart().split(/\s+/);
      if (parts.length > 1) return null;
      const query = (parts[0] ?? "").toLowerCase();
      return ["settings", "config", "status"]
        .filter((action) => action.startsWith(query))
        .map((action) => ({ value: action, label: action }));
    },
    handler: async (args, ctx) => {
      lastCtx = ctx;
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const subcommand = (parts[0] ?? "").toLowerCase();
      const agentDir = getAgentDir();

      if (subcommand === "status") {
        const loaded = loadContextHooks(ctx);
        const probe = probeBwrapAvailability();
        const { formatBwrapProbeStatus } = await import("./settings.js");
        const sandboxState = isHookSandboxEnabled(loaded.sandbox)
          ? isHookSandboxOffline(loaded.sandbox)
            ? "enabled (offline)"
            : "enabled"
          : "disabled";
        const summary = [
          `Hooks: ${loaded.sessionStart.length} sessionStart, ${loaded.preTool.length} preTool, ${loaded.postTool.length} postTool`,
          `Sandbox: ${sandboxState}`,
          `Bubblewrap (bwrap): ${formatBwrapProbeStatus(probe)}`,
        ].join("\n");
        if (ctx.hasUI) ctx.ui.notify(summary, "info");
        return;
      }

      if (
        subcommand !== "" &&
        subcommand !== "settings" &&
        subcommand !== "config"
      ) {
        if (ctx.hasUI) {
          ctx.ui.notify("Usage: /hooks [settings|config|status]", "info");
        }
        return;
      }

      const loaded = loadAgentHooksConfig(agentDir);
      if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
        if (ctx.hasUI) {
          for (const diagnostic of loaded.diagnostics) {
            ctx.ui.notify(
              `pi-hooks: ${diagnostic}`,
              isPermissionError(diagnostic) ? "error" : "warning",
            );
          }
          ctx.ui.notify(
            `Hooks settings require TUI mode; edit ${loaded.path}`,
            "info",
          );
        }
        return;
      }

      for (const diagnostic of loaded.diagnostics) {
        ctx.ui.notify(
          `pi-hooks: ${diagnostic}`,
          isPermissionError(diagnostic) ? "error" : "warning",
        );
      }

      let saved = false;
      const { showHooksSettings } = await import("./settings.js");
      await showHooksSettings(ctx, loaded.config, (settings: HooksSettings) => {
        try {
          saveHooksSettings(agentDir, settings);
          saved = true;
          publishHooksSnapshot(ctx);
        } catch (error) {
          ctx.ui.notify(
            `pi-hooks: failed to save settings: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
        }
      });
      if (saved) ctx.ui.notify("Hooks settings saved", "info");
    },
  });

  pi.on("session_shutdown", () => {
    clearHooksCache();
  });
}
