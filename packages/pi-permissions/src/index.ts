import { statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fdTool } from "./fd.js";
import {
  clearCwdOverride,
  effectiveCwd,
  loadRules,
  setCwdOverride,
} from "./loader.js";
import { rgTool } from "./rg.js";
import { type Effect, type Verb, check } from "./rules.js";

// Bash is not checked here: bash can still write outside allowed paths until bash rules exist.
const TOOL_VERBS: Record<string, Verb> = {
  write: "write",
  edit: "write",
  find: "read",
  grep: "read",
  fd: "read",
  rg: "read",
};

const NAVIGATED_TOOLS: ReadonlySet<string> = new Set(["read", "ls"]);

function readPathArg(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const path = (input as Record<string, unknown>).path;
  return typeof path === "string" && path !== "" ? path : undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool(fdTool);
  pi.registerTool(rgTool);
  pi.on("tool_call", (event, ctx) => {
    const verb: Verb | undefined = TOOL_VERBS[event.toolName];
    const cwd = effectiveCwd(ctx);
    if (
      (verb !== undefined || NAVIGATED_TOOLS.has(event.toolName)) &&
      cwd !== ctx.cwd
    ) {
      const record = event.input as Record<string, unknown>;
      if (
        typeof record.path === "string" &&
        record.path !== "" &&
        !isAbsolute(record.path)
      ) {
        record.path = resolve(cwd, record.path);
      }
    }
    if (verb === undefined) return undefined;
    const rules = loadRules(ctx);
    if (rules === undefined) return undefined;
    const raw = readPathArg(event.input) ?? ".";
    const verdict: Effect = check(rules, raw, verb, ctx.cwd);
    if (verdict === "deny") {
      return {
        block: true,
        reason: `pi-permissions: ${verb} access to ${raw} is denied`,
      };
    }
    return undefined;
  });
  pi.on("session_start", (_event, ctx) => {
    clearCwdOverride(ctx.sessionManager);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    clearCwdOverride(ctx.sessionManager);
  });
  pi.registerCommand("cd", {
    description:
      "Change the working directory for file tools (stays inside the project root)",
    handler: async (args, ctx) => {
      const raw = args.trim();
      if (raw === "") {
        setCwdOverride(ctx.sessionManager, undefined);
        ctx.ui.setStatus("cwd", undefined);
        ctx.ui.notify(`pi-permissions: working directory ${ctx.cwd}`);
        return;
      }
      const abs = resolve(effectiveCwd(ctx), raw);
      let isDir = false;
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) {
        ctx.ui.notify(`pi-permissions: not a directory: ${raw}`, "error");
        return;
      }
      const rel = relative(ctx.cwd, abs);
      if (rel === ".." || rel.startsWith(`..${sep}`)) {
        ctx.ui.notify(`pi-permissions: outside project root: ${raw}`, "error");
        return;
      }
      const rules = loadRules(ctx);
      if (
        rules !== undefined &&
        check(rules, abs, "read", ctx.cwd) === "deny"
      ) {
        ctx.ui.notify(
          `pi-permissions: directory denied by rules: ${raw}`,
          "error",
        );
        return;
      }
      setCwdOverride(ctx.sessionManager, abs);
      ctx.ui.setStatus("cwd", rel === "" ? "." : rel.split(sep).join("/"));
      ctx.ui.notify(`pi-permissions: working directory ${abs}`);
    },
  });
}
