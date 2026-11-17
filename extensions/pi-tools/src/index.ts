import { type Dirent, readdirSync, statSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { effectiveCwd, readPersistedCwd, setCwd } from "@hollowheap/core/state";
import { isPathDenied } from "./permissions.js";

function isWithinRoot(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
  );
}

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
      return isWithinRoot(root, abs) && !isPathDenied(ctx, abs, root);
    })
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const abs = join(absDir, entry.name);
      const rel = relative(base, abs).split(sep).join("/");
      return { value: `${rel}/`, label: `${entry.name}/` };
    });
}

export default function (pi: ExtensionAPI) {
  let completionCtx: ExtensionContext | undefined;

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
      const within = isWithinRoot(ctx.cwd, restored);
      const denied = isPathDenied(ctx, restored, ctx.cwd);
      if (isDir && within && !denied) {
        setCwd(ctx.sessionManager, restored);
        updateSessionSnapshot(ctx.sessionManager, "cwd", {
          root: ctx.cwd,
          effective: restored,
          updatedAt: Date.now(),
        });
        const rel = relative(ctx.cwd, restored);
        ctx.ui?.setStatus?.("cwd", rel === "" ? "." : rel.split(sep).join("/"));
        return;
      }
    }
    setCwd(ctx.sessionManager, undefined, { persist: true });
    ctx.ui?.setStatus?.("cwd", undefined);
  };

  pi.on("session_start", (_event, ctx) => {
    restoreCwd(ctx);
  });
  pi.on("session_tree", (_event, ctx) => {
    restoreCwd(ctx);
  });
  pi.on("session_shutdown", () => {
    completionCtx = undefined;
  });
  pi.on("session_compact", (_event, ctx) => {
    const currentCtx = ctx ?? completionCtx;
    if (!currentCtx?.sessionManager) return;
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
        ctx.ui.setStatus("cwd", undefined);
        ctx.ui.notify(
          `pi-tools: working directory ${sanitizeTerminalText(ctx.cwd)}`,
        );
        return;
      }
      const abs = resolve(effectiveCwd(ctx.cwd, ctx.sessionManager), raw);
      let isDir = false;
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) {
        ctx.ui.notify(
          `pi-tools: not a directory: ${sanitizeTerminalText(raw)}`,
          "error",
        );
        return;
      }
      const rel = relative(ctx.cwd, abs);
      if (!isWithinRoot(ctx.cwd, abs)) {
        ctx.ui.notify(
          `pi-tools: outside project root: ${sanitizeTerminalText(raw)}`,
          "error",
        );
        return;
      }
      if (isPathDenied(ctx, abs, ctx.cwd)) {
        ctx.ui.notify(
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
      ctx.ui.setStatus("cwd", rel === "" ? "." : rel.split(sep).join("/"));
      ctx.ui.notify(`pi-tools: working directory ${sanitizeTerminalText(abs)}`);
    },
  });
}
