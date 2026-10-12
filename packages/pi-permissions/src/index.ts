import { statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { fdTool } from "./fd.js";
import {
  clearCwdOverride,
  effectiveCwd,
  loadRules,
  setCwdOverride,
} from "./loader.js";
import { rgTool } from "./rg.js";
import { type Tag, type Verdict, check } from "./rules.js";

const TOOL_TAGS: Record<string, Tag> = {
  write: "edit",
  edit: "edit",
  read: "read",
  find: "search",
  grep: "search",
  fd: "search",
  rg: "search",
  ls: "search",
  bash: "shell",
  powershell: "shell",
};

function readPathArg(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const path = (input as Record<string, unknown>).path;
  return typeof path === "string" && path !== "" ? path : undefined;
}

function readCommandArg(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const command = (input as Record<string, unknown>).command;
  return typeof command === "string" ? command : "";
}

function displayTarget(target: string): string {
  return target.length > 500 ? `${target.slice(0, 500)}…` : target;
}

async function requestApproval(
  toolName: string,
  target: string,
  ctx: ExtensionContext,
): Promise<{ block: true; reason: string } | undefined> {
  if (!ctx.hasUI) {
    return {
      block: true,
      reason: `pi-permissions: ${toolName} ${displayTarget(target)} needs approval (no UI)`,
    };
  }
  const approved = await ctx.ui.confirm(
    `Allow ${toolName}?`,
    displayTarget(target),
  );
  if (!approved) {
    return {
      block: true,
      reason: `pi-permissions: ${toolName} ${displayTarget(target)} was not approved`,
    };
  }
  return undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool(fdTool);
  pi.registerTool(rgTool);
  pi.on("tool_call", async (event, ctx) => {
    const tag: Tag | undefined = TOOL_TAGS[event.toolName];
    const cwd = effectiveCwd(ctx);
    if (cwd !== ctx.cwd) {
      const record = event.input as Record<string, unknown>;
      if (
        typeof record.path === "string" &&
        record.path !== "" &&
        !isAbsolute(record.path)
      ) {
        record.path = resolve(cwd, record.path);
      }
    }
    const raw =
      tag === "shell"
        ? readCommandArg(event.input)
        : (readPathArg(event.input) ?? ".");
    if (tag === undefined) return requestApproval(event.toolName, raw, ctx);
    const verdict: Verdict = check(loadRules(ctx), raw, tag, ctx.cwd);
    if (verdict === "deny") {
      return {
        block: true,
        reason: `pi-permissions: ${tag} access to ${displayTarget(raw)} is denied`,
      };
    }
    if (verdict === "ask") return requestApproval(event.toolName, raw, ctx);
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
      if (check(rules, abs, "read", ctx.cwd) === "deny") {
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
