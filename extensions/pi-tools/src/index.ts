import { type Dirent, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { displayPath, sanitizeTerminalText } from "@hollowheap/core/format";
import { isWithinWorkspace, resolveScopedPath } from "@hollowheap/core/scope";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { effectiveCwd, readPersistedCwd, setCwd } from "@hollowheap/core/state";
import { hostUi, notify } from "@hollowheap/pi-ui/host";
import { registerCodemodeTools } from "./codemode.js";
import { isPathDenied } from "./permissions.js";

function completeCd(prefix: string, ctx: ExtensionContext) {
  const root = ctx.cwd;
  const base = effectiveCwd(ctx.cwd, ctx.sessionManager);
  const trimmed = prefix.trim();
  const dir =
    trimmed === "" || trimmed.endsWith("/") ? trimmed || "." : dirname(trimmed);
  const start =
    trimmed === "" || trimmed.endsWith("/") ? "" : basename(trimmed);
  const absDir = resolve(base, dir);
  let entries: Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return null;
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(start))
    .filter((entry) => {
      const abs = join(absDir, entry.name);
      return isWithinWorkspace(root, abs) && !isPathDenied(ctx, abs, root);
    })
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const abs = join(absDir, entry.name);
      const rel = displayPath(base, abs);
      return { value: `${rel}/`, label: `${entry.name}/` };
    });
}

export default function (pi: ExtensionAPI) {
  let completionCtx: ExtensionContext | undefined;
  const cancelCompaction = registerCodemodeTools(pi);

  const restoreCwd = (ctx: ExtensionContext): void => {
    completionCtx = ctx;
    const restored = readPersistedCwd(ctx.sessionManager);
    if (typeof restored === "string" && restored !== "") {
      let isDir = false;
      try {
        isDir = statSync(restored).isDirectory();
      } catch {
        isDir = false;
      }
      const within = isWithinWorkspace(ctx.cwd, restored);
      const denied = isPathDenied(ctx, restored, ctx.cwd);
      if (isDir && within && !denied) {
        setCwd(ctx.sessionManager, restored);
        updateSessionSnapshot(ctx.sessionManager, "cwd", {
          root: ctx.cwd,
          effective: restored,
          updatedAt: Date.now(),
        });
        const rel = displayPath(ctx.cwd, restored);
        hostUi(ctx)?.setStatus?.("cwd", rel === "" ? "." : rel);
        return;
      }
    }
    setCwd(ctx.sessionManager, undefined, { persist: true });
    hostUi(ctx)?.setStatus?.("cwd", undefined);
  };

  pi.on("session_start", (_event, ctx) => {
    cancelCompaction(ctx);
    restoreCwd(ctx);
  });
  pi.on("session_tree", (_event, ctx) => {
    cancelCompaction(ctx);
    restoreCwd(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    cancelCompaction(ctx);
    completionCtx = undefined;
  });
  pi.on("session_compact", (_event, ctx) => {
    const currentCtx = ctx ?? completionCtx;
    if (!currentCtx?.sessionManager) return;
    cancelCompaction(currentCtx);
    const currentCwd = effectiveCwd(currentCtx.cwd, currentCtx.sessionManager);
    if (currentCwd !== currentCtx.cwd) {
      setCwd(currentCtx.sessionManager, currentCwd, { persist: true });
      updateSessionSnapshot(currentCtx.sessionManager, "cwd", {
        root: currentCtx.cwd,
        effective: currentCwd,
        updatedAt: Date.now(),
      });
    }
  });

  pi.registerCommand("cd", {
    description:
      "Change the working directory for file tools (stays inside the project root)",
    getArgumentCompletions: (prefix: string) =>
      completionCtx === undefined ? null : completeCd(prefix, completionCtx),
    handler: async (args, ctx) => {
      const raw = args.trim();
      if (raw === "") {
        setCwd(ctx.sessionManager, undefined, { persist: true });
        hostUi(ctx).setStatus("cwd", undefined);
        notify(
          ctx,
          `pi-tools: working directory ${sanitizeTerminalText(ctx.cwd)}`,
        );
        return;
      }
      const abs = resolveScopedPath(ctx.cwd, raw, ctx.sessionManager);
      let isDir = false;
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) {
        notify(
          ctx,
          `pi-tools: not a directory: ${sanitizeTerminalText(raw)}`,
          "error",
        );
        return;
      }
      const rel = displayPath(ctx.cwd, abs);
      if (!isWithinWorkspace(ctx.cwd, abs)) {
        notify(
          ctx,
          `pi-tools: outside project root: ${sanitizeTerminalText(raw)}`,
          "error",
        );
        return;
      }
      if (isPathDenied(ctx, abs, ctx.cwd)) {
        notify(
          ctx,
          `pi-tools: directory denied by rules: ${sanitizeTerminalText(raw)}`,
          "error",
        );
        return;
      }
      setCwd(ctx.sessionManager, abs, { persist: true });
      updateSessionSnapshot(ctx.sessionManager, "cwd", {
        root: ctx.cwd,
        effective: abs,
        updatedAt: Date.now(),
      });
      hostUi(ctx).setStatus("cwd", rel === "" ? "." : rel);
      notify(ctx, `pi-tools: working directory ${sanitizeTerminalText(abs)}`);
    },
  });
}
