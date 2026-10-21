import { type Dirent, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveDir, setCwdOverride, setEventSink } from "./cwd.js";
import { fdTool } from "./fd.js";
import { loadRules } from "./loader.js";
import { rgTool } from "./rg.js";
import { check } from "./rules.js";

function completeCd(prefix: string) {
  const trimmed = prefix.trim();
  const dir =
    trimmed === "" || trimmed.endsWith("/") ? trimmed || "." : dirname(trimmed);
  const start =
    trimmed === "" || trimmed.endsWith("/") ? "" : basename(trimmed);
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(start))
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({ value: `${join(dir, name)}/`, label: `${name}/` }));
}

export default function (pi: ExtensionAPI) {
  setEventSink(pi.events);
  pi.registerTool(fdTool);
  pi.registerTool(rgTool);
  pi.registerCommand("cd", {
    description:
      "Change the working directory for file tools (stays inside the project root)",
    getArgumentCompletions: (prefix: string) => completeCd(prefix),
    handler: async (args, ctx) => {
      const raw = args.trim();
      if (raw === "") {
        setCwdOverride(ctx.sessionManager, undefined);
        ctx.ui.setStatus("cwd", undefined);
        ctx.ui.notify(`pi-tools: working directory ${ctx.cwd}`);
        return;
      }
      const abs = resolve(
        resolveEffectiveDir(ctx.cwd, ctx.sessionManager),
        raw,
      );
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
      if (rel === ".." || rel.startsWith(`..${sep}`)) {
        ctx.ui.notify(`pi-tools: outside project root: ${raw}`, "error");
        return;
      }
      const rules = loadRules(ctx);
      if (check(rules, abs, "read", ctx.cwd) === "deny") {
        ctx.ui.notify(`pi-tools: directory denied by rules: ${raw}`, "error");
        return;
      }
      setCwdOverride(ctx.sessionManager, abs);
      ctx.ui.setStatus("cwd", rel === "" ? "." : rel.split(sep).join("/"));
      ctx.ui.notify(`pi-tools: working directory ${abs}`);
    },
  });
}
