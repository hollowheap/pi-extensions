import { type Dirent, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { checkPath, effectiveCwd, setCwd } from "@hollowheap/core";
import { loadToolsConfig } from "./config.js";
import { createFdTool } from "./fd.js";
import { loadContextPermissions } from "./permissions.js";
import { createRgTool } from "./rg.js";

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
  const diagnostics: string[] = [];
  const config = loadToolsConfig(getAgentDir(), (message) =>
    diagnostics.push(message),
  );
  if (config.fd !== "hidden") {
    pi.registerTool(createFdTool(undefined, config.fd));
  }
  if (config.rg !== "hidden") {
    pi.registerTool(createRgTool(undefined, config.rg));
  }
  const needsCodemode = config.fd === "codemode" || config.rg === "codemode";
  let reported = false;
  pi.on("session_start", (_event, ctx) => {
    if (!reported && diagnostics.length > 0) {
      reported = true;
      for (const message of diagnostics) {
        ctx.ui.notify(`pi-tools: ${message}`, "warning");
      }
    }
    if (!needsCodemode) return;
    if (!pi.getAllTools().some((tool) => tool.name === "codemode")) return;
    const active = pi.getActiveTools();
    if (active.includes("codemode")) return;
    pi.setActiveTools([...active, "codemode"]);
  });
  pi.registerCommand("cd", {
    description:
      "Change the working directory for file tools (stays inside the project root)",
    getArgumentCompletions: (prefix: string) => completeCd(prefix),
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
      if (rel === ".." || rel.startsWith(`..${sep}`)) {
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
