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
import { checkPath, effectiveCwd, setCwd } from "@hollowheap/core";
import { loadContextPermissions } from "./permissions.js";

function isWithinRoot(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
  );
}

function completeCd(prefix: string, ctx?: ExtensionContext) {
  const root = ctx?.cwd ?? process.cwd();
  const base = ctx ? effectiveCwd(ctx.cwd, ctx.sessionManager) : root;
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
  const rules = ctx ? loadContextPermissions(ctx) : undefined;
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(start))
    .filter((entry) => {
      if (rules === undefined) return true;
      const abs = join(absDir, entry.name);
      return (
        isWithinRoot(root, abs) &&
        checkPath(rules, abs, "read", root) !== "deny"
      );
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
  pi.on("session_start", (_event, ctx) => {
    completionCtx = ctx;
  });
  pi.registerCommand("cd", {
    description:
      "Change the working directory for file tools (stays inside the project root)",
    getArgumentCompletions: (prefix: string) =>
      completeCd(prefix, completionCtx),
    handler: async (args, ctx) => {
      const raw = args.trim();
      if (raw === "") {
        setCwd(ctx.sessionManager, undefined);
        ctx.ui.setStatus("cwd", undefined);
        ctx.ui.notify(`pi-tools: working directory ${ctx.cwd}`);
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
        ctx.ui.notify(`pi-tools: not a directory: ${raw}`, "error");
        return;
      }
      const rel = relative(ctx.cwd, abs);
      if (!isWithinRoot(ctx.cwd, abs)) {
        ctx.ui.notify(`pi-tools: outside project root: ${raw}`, "error");
        return;
      }
      const rules = loadContextPermissions(ctx);
      if (checkPath(rules, abs, "read", ctx.cwd) === "deny") {
        ctx.ui.notify(`pi-tools: directory denied by rules: ${raw}`, "error");
        return;
      }
      setCwd(ctx.sessionManager, abs);
      ctx.ui.setStatus("cwd", rel === "" ? "." : rel.split(sep).join("/"));
      ctx.ui.notify(`pi-tools: working directory ${abs}`);
    },
  });
}
