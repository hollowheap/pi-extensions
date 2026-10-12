import { statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { checkBash } from "./bash.js";
import {
  addBudgetUsage,
  clearBudget,
  formatBudget,
  getBudgetUsed,
} from "./budget.js";
import { fdTool } from "./fd.js";
import {
  clearCwdOverride,
  effectiveCwd,
  loadRules,
  setCwdOverride,
} from "./loader.js";
import {
  applyMode,
  clearMode,
  getMode,
  getTokenCap,
  isMode,
  isPlanPath,
  planRules,
  setMode,
  setTokenCap,
} from "./modes.js";
import { rgTool } from "./rg.js";
import { type Tag, check } from "./rules.js";

const TOOL_TAGS: Record<string, Tag> = {
  write: "edit",
  edit: "edit",
  read: "read",
  find: "search",
  grep: "search",
  fd: "search",
  rg: "search",
  ls: "search",
  powershell: "bash",
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
      reason: `pi-mode-guard: ${toolName} ${displayTarget(target)} needs approval (no UI)`,
    };
  }
  const approved = await ctx.ui.confirm(
    `Allow ${toolName}?`,
    displayTarget(target),
  );
  if (!approved) {
    return {
      block: true,
      reason: `pi-mode-guard: ${toolName} ${displayTarget(target)} was not approved`,
    };
  }
  return undefined;
}

function refreshBudget(ctx: ExtensionContext): void {
  const text = formatBudget(
    getBudgetUsed(ctx.sessionManager),
    getTokenCap(ctx.sessionManager),
  );
  ctx.ui.setStatus("budget", text === "" ? undefined : text);
  publishValues(ctx.sessionManager);
}

interface EventSink {
  emit(channel: string, data: unknown): void;
}

let eventSink: EventSink | undefined;
let lastOwner: unknown;

function publishValues(owner: unknown): void {
  lastOwner = owner;
  if (eventSink === undefined) return;
  eventSink.emit("statusline:values", {
    name: "mode-guard",
    text: getMode(owner).toUpperCase(),
  });
  eventSink.emit("statusline:values", {
    name: "budgets",
    text: formatBudget(getBudgetUsed(owner), getTokenCap(owner)),
  });
}

export default function (pi: ExtensionAPI) {
  eventSink = pi.events;
  pi.events.on("statusline:request", () => {
    if (lastOwner !== undefined) publishValues(lastOwner);
  });
  pi.registerTool(fdTool);
  pi.registerTool(rgTool);
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" || event.toolName === "powershell") {
      const verdict = checkBash(readCommandArg(event.input), loadRules(ctx));
      if (!verdict.allowed) {
        return {
          block: true,
          reason: `pi-mode-guard: ${event.toolName} denied: ${verdict.reason ?? "no allow rule"}`,
        };
      }
      return undefined;
    }
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
    const mode = getMode(ctx.sessionManager);
    const base = loadRules(ctx);
    const rules = mode === "plan" ? [...base, ...planRules()] : base;
    const verdict = check(rules, raw, tag, ctx.cwd);
    const final = applyMode(
      mode,
      tag,
      verdict,
      tag === "edit" && isPlanPath(raw, ctx.cwd),
    );
    if (final === "deny") {
      return {
        block: true,
        reason: `pi-mode-guard: ${tag} access to ${displayTarget(raw)} is denied`,
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
        text: `${block.text.slice(0, 3000)}\n[pi-mode-guard: cut ${cut} characters]\n${block.text.slice(-1000)}`,
      };
    });
    if (!changed) return undefined;
    return { content };
  });
  pi.on("session_start", (_event, ctx) => {
    clearCwdOverride(ctx.sessionManager);
    clearMode(ctx.sessionManager);
    clearBudget(ctx.sessionManager);
    refreshBudget(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    clearCwdOverride(ctx.sessionManager);
    clearMode(ctx.sessionManager);
    clearBudget(ctx.sessionManager);
  });
  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const usage = event.message.usage;
    if (
      usage === undefined ||
      typeof usage.input !== "number" ||
      typeof usage.output !== "number"
    ) {
      ctx.ui.notify(
        "pi-mode-guard: model response reported no usage; budget total unchanged",
        "warning",
      );
      return;
    }
    addBudgetUsage(ctx.sessionManager, usage.input + usage.output);
    refreshBudget(ctx);
  });
  pi.on("before_agent_start", (_event, ctx) => {
    const cap = getTokenCap(ctx.sessionManager);
    if (cap === undefined) return;
    const used = getBudgetUsed(ctx.sessionManager);
    if (used < cap) return;
    ctx.ui.notify(
      `pi-mode-guard: token budget reached (${formatBudget(used, cap)}); raise it with /budget to continue`,
      "error",
    );
    ctx.abort();
  });
  // TODO: /cd may move to a utility package (e.g. pi-tools alongside fd/rg); placement undecided.
  pi.registerCommand("cd", {
    description:
      "Change the working directory for file tools (stays inside the project root)",
    handler: async (args, ctx) => {
      const raw = args.trim();
      if (raw === "") {
        setCwdOverride(ctx.sessionManager, undefined);
        ctx.ui.setStatus("cwd", undefined);
        ctx.ui.notify(`pi-mode-guard: working directory ${ctx.cwd}`);
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
        ctx.ui.notify(`pi-mode-guard: not a directory: ${raw}`, "error");
        return;
      }
      const rel = relative(ctx.cwd, abs);
      if (rel === ".." || rel.startsWith(`..${sep}`)) {
        ctx.ui.notify(`pi-mode-guard: outside project root: ${raw}`, "error");
        return;
      }
      const rules = loadRules(ctx);
      if (check(rules, abs, "read", ctx.cwd) === "deny") {
        ctx.ui.notify(
          `pi-mode-guard: directory denied by rules: ${raw}`,
          "error",
        );
        return;
      }
      setCwdOverride(ctx.sessionManager, abs);
      ctx.ui.setStatus("cwd", rel === "" ? "." : rel.split(sep).join("/"));
      ctx.ui.notify(`pi-mode-guard: working directory ${abs}`);
    },
  });
  pi.registerCommand("mode", {
    description:
      "Show or switch the plan/approval mode (plan, ask, allow-edits, autopilot)",
    handler: async (args, ctx) => {
      const raw = args.trim().toLowerCase();
      if (raw === "") {
        ctx.ui.notify(`pi-mode-guard: mode ${getMode(ctx.sessionManager)}`);
        return;
      }
      if (!isMode(raw)) {
        ctx.ui.notify(
          `pi-mode-guard: unknown mode: ${args.trim()} (plan, ask, allow-edits, autopilot)`,
          "error",
        );
        return;
      }
      if (
        raw === "autopilot" &&
        getTokenCap(ctx.sessionManager) === undefined
      ) {
        ctx.ui.notify(
          "pi-mode-guard: autopilot refused: set a token cap first",
          "error",
        );
        return;
      }
      setMode(ctx.sessionManager, raw);
      if (raw === "autopilot") {
        ctx.ui.notify(
          "pi-mode-guard: autopilot on: write and bash run without asking",
          "warning",
        );
      } else {
        ctx.ui.notify(`pi-mode-guard: mode ${raw}`);
      }
      publishValues(ctx.sessionManager);
    },
  });
  pi.registerCommand("budget", {
    description: "Show or set the session token budget in whole tokens",
    handler: async (args, ctx) => {
      const raw = args.trim();
      const used = getBudgetUsed(ctx.sessionManager);
      const cap = getTokenCap(ctx.sessionManager);
      if (raw === "") {
        const text = formatBudget(used, cap) || "0 used";
        ctx.ui.notify(
          `pi-mode-guard: budget ${text}${cap === undefined ? " (no cap set)" : ""}`,
        );
        return;
      }
      if (!/^\d+$/.test(raw)) {
        ctx.ui.notify(
          "pi-mode-guard: budget cap must be a whole number of tokens",
          "error",
        );
        return;
      }
      const next = Number(raw);
      if (!Number.isSafeInteger(next) || next <= 0) {
        ctx.ui.notify(
          "pi-mode-guard: budget cap must be greater than 0",
          "error",
        );
        return;
      }
      setTokenCap(ctx.sessionManager, next);
      refreshBudget(ctx);
      ctx.ui.notify(
        `pi-mode-guard: budget cap ${next.toLocaleString("en-US")} tokens (${formatBudget(used, next)})`,
      );
    },
  });
}
