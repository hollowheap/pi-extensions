import { isAbsolute, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import type {
  CwdQuery,
  CwdSetCommand,
  ModeDefinition,
  ModeEnterQuery,
  ModesQuery,
  Tag,
} from "@hollowheap/core";
import { checkBash } from "./bash.js";
import { loadRules } from "./loader.js";
import {
  applyPolicy,
  builtinModes,
  clearCwdOverride,
  clearMode,
  effectiveCwd,
  getCwdOverride,
  getMode,
  isPlanPath,
  planRules,
  setCwdOverride,
  setMode,
} from "./modes.js";
import { check } from "./rules.js";

export const GUARD_MODES_CHANNEL = "guard:modes";
export const GUARD_MODE_ENTER_CHANNEL = "guard:mode-enter";
export const GUARD_CWD_SET_CHANNEL = "guard:cwd-set";
export const GUARD_CWD_QUERY_CHANNEL = "guard:cwd-query";

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
      reason: `pi-guard: ${toolName} ${displayTarget(target)} needs approval (no UI)`,
    };
  }
  const approved = await ctx.ui.confirm(
    `Allow ${toolName}?`,
    displayTarget(target),
  );
  if (!approved) {
    return {
      block: true,
      reason: `pi-guard: ${toolName} ${displayTarget(target)} was not approved`,
    };
  }
  return undefined;
}

interface EventSink {
  emit(channel: string, data: unknown): void;
}

let eventSink: EventSink | undefined;
let lastOwner: unknown;
let cachedModes: ModeDefinition[] = builtinModes();

function modeNames(): string[] {
  return cachedModes.map((entry) => entry.name);
}

function nextMode(mode: string): string {
  const names = modeNames();
  const at = names.indexOf(mode);
  if (at < 0) return mode;
  return names[(at + 1) % names.length];
}

function refreshModes(): void {
  const query: ModesQuery = { modes: builtinModes() };
  eventSink?.emit(GUARD_MODES_CHANNEL, query);
  cachedModes = query.modes;
}

function publishValues(owner: unknown): void {
  lastOwner = owner;
  if (eventSink === undefined) return;
  eventSink.emit("statusline:values", {
    name: "mode-guard",
    text: getMode(owner).toUpperCase(),
  });
}

async function switchMode(ctx: ExtensionContext, raw: string): Promise<void> {
  const entry = cachedModes.find((candidate) => candidate.name === raw);
  if (entry === undefined) {
    ctx.ui.notify(
      `pi-guard: unknown mode: ${raw} (${modeNames().join(", ")})`,
      "error",
    );
    return;
  }
  const notice = entry.onEnter?.(ctx.sessionManager)?.notice;
  const query: ModeEnterQuery = { mode: raw, owner: ctx.sessionManager };
  eventSink?.emit(GUARD_MODE_ENTER_CHANNEL, query);
  if (query.veto !== undefined) {
    ctx.ui.notify(`pi-guard: ${query.veto}`, "error");
    return;
  }
  setMode(ctx.sessionManager, raw);
  if (notice !== undefined) {
    ctx.ui.notify(`pi-guard: ${notice.text}`, notice.level);
  } else {
    ctx.ui.notify(`pi-guard: mode ${raw}`);
  }
  publishValues(ctx.sessionManager);
}

export default function (pi: ExtensionAPI) {
  eventSink = pi.events;
  pi.events.on("statusline:request", () => {
    if (lastOwner !== undefined) publishValues(lastOwner);
  });
  pi.events.on(GUARD_CWD_SET_CHANNEL, (data) => {
    const command = data as CwdSetCommand;
    setCwdOverride(command.owner, command.dir);
  });
  pi.events.on(GUARD_CWD_QUERY_CHANNEL, (data) => {
    const query = data as CwdQuery;
    const dir = getCwdOverride(query.owner);
    if (dir !== undefined) query.dir = dir;
  });
  pi.on("tool_call", async (event, ctx) => {
    const tag: Tag | undefined = TOOL_TAGS[event.toolName];
    const mode = getMode(ctx.sessionManager);
    if (tag === "shell") {
      const command = readCommandArg(event.input);
      const gate = checkBash(command, loadRules(ctx));
      const final = applyPolicy(cachedModes, mode, "shell", gate.decision, {
        inPlanPaths: false,
      });
      if (final === "deny") {
        const reason =
          gate.decision === "deny"
            ? (gate.reason ?? "denied")
            : "mode denies shell";
        return {
          block: true,
          reason: `pi-guard: ${event.toolName} denied: ${reason}`,
        };
      }
      if (final === "ask") {
        return requestApproval(event.toolName, command, ctx);
      }
      return undefined;
    }
    const cwd = effectiveCwd(ctx.cwd, ctx.sessionManager);
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
    const raw = readPathArg(event.input) ?? ".";
    if (tag === undefined) return requestApproval(event.toolName, raw, ctx);
    const base = loadRules(ctx);
    const rules = mode === "plan" ? [...base, ...planRules()] : base;
    const verdict = check(rules, raw, tag, ctx.cwd);
    const final = applyPolicy(cachedModes, mode, tag, verdict, {
      inPlanPaths: tag === "edit" && isPlanPath(raw, ctx.cwd),
    });
    if (final === "deny") {
      return {
        block: true,
        reason: `pi-guard: ${tag} access to ${displayTarget(raw)} is denied`,
      };
    }
    if (final === "ask") return requestApproval(event.toolName, raw, ctx);
    return undefined;
  });
  pi.on("tool_result", (event, _ctx) => {
    if (event.toolName !== "bash") return undefined;
    let changed = false;
    const content = event.content.map((block) => {
      if (block.type !== "text" || block.text.length <= 4000) return block;
      changed = true;
      const cut = block.text.length - 4000;
      return {
        ...block,
        text: `${block.text.slice(0, 3000)}\n[pi-guard: cut ${cut} characters]\n${block.text.slice(-1000)}`,
      };
    });
    if (!changed) return undefined;
    return { content };
  });
  pi.on("session_start", (_event, ctx) => {
    clearMode(ctx.sessionManager);
    clearCwdOverride(ctx.sessionManager);
    refreshModes();
    publishValues(ctx.sessionManager);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    clearMode(ctx.sessionManager);
    clearCwdOverride(ctx.sessionManager);
  });
  pi.registerCommand("mode", {
    description: "Show or switch the plan/approval mode",
    getArgumentCompletions: (prefix: string) => {
      const lower = prefix.trim().toLowerCase();
      return modeNames()
        .filter((mode) => mode.startsWith(lower))
        .map((mode) => ({ value: mode, label: mode }));
    },
    handler: async (args, ctx) => {
      const raw = args.trim().toLowerCase();
      if (raw === "") {
        ctx.ui.notify(
          `pi-guard: mode ${getMode(ctx.sessionManager)} (${modeNames().join(", ")})`,
        );
        return;
      }
      await switchMode(ctx, raw);
    },
  });
  pi.registerShortcut(Key.alt("m"), {
    description: "Cycle plan/approval mode",
    handler: (ctx) => switchMode(ctx, nextMode(getMode(ctx.sessionManager))),
  });
}
