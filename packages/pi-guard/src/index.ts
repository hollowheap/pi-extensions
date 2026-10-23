import { isAbsolute, resolve } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import {
  type Tag,
  displayTarget,
  dropSession,
  effectiveCwd,
  enterMode,
  evaluate,
  loadModesConfig,
  loadPermissions,
  modeNames,
  replaceConfigModes,
  resetSession,
  session,
  truncateText,
} from "@hollowheap/core";

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

interface EventSink {
  emit(channel: string, data: unknown): void;
}

let eventSink: EventSink | undefined;
let lastOwner: unknown;

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

function loadContextPermissions(ctx: ExtensionContext) {
  return loadPermissions({
    agentDir: getAgentDir(),
    workspaceRoot: ctx.cwd,
    trusted: ctx.isProjectTrusted(),
    onDiagnostic: (message) => ctx.ui.notify(`pi-guard: ${message}`, "warning"),
  });
}

function publishValues(owner: unknown): void {
  lastOwner = owner;
  if (eventSink === undefined) return;
  eventSink.emit("statusline:values", {
    name: "mode-guard",
    text: session(owner).mode.toUpperCase(),
  });
}

function nextMode(current: string): string {
  const names = modeNames();
  if (names.length === 0) return current;
  const index = names.indexOf(current);
  if (index < 0) return names[0] ?? current;
  return names[(index + 1) % names.length] ?? current;
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

async function switchMode(ctx: ExtensionContext, raw: string): Promise<void> {
  const result = enterMode(ctx.sessionManager, raw);
  if (result.diagnostic !== undefined) {
    ctx.ui.notify(`pi-guard: ${result.diagnostic}`, "error");
    return;
  }
  if (result.veto !== undefined) {
    // A veto means the mode never became active, so its "on" notices would
    // misreport the session; only the refusal is shown.
    ctx.ui.notify(`pi-guard: ${result.veto}`, "error");
    return;
  }
  if (result.notices.length > 0) {
    for (const notice of result.notices) {
      ctx.ui.notify(`pi-guard: ${notice.text}`, notice.level);
    }
  } else {
    ctx.ui.notify(`pi-guard: mode ${result.mode}`);
  }
  publishValues(ctx.sessionManager);
}

export default function (pi: ExtensionAPI) {
  eventSink = pi.events;
  pi.events.on("statusline:request", () => {
    if (lastOwner !== undefined) publishValues(lastOwner);
  });
  pi.on("tool_call", async (event, ctx) => {
    const tag: Tag | undefined = TOOL_TAGS[event.toolName];
    if (tag === undefined) {
      const raw = readPathArg(event.input) ?? ".";
      return requestApproval(event.toolName, raw, ctx);
    }
    if (tag !== "shell") {
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
    }
    const target =
      tag === "shell"
        ? readCommandArg(event.input)
        : (readPathArg(event.input) ?? ".");
    const verdict = evaluate({
      owner: ctx.sessionManager,
      cwd: ctx.cwd,
      tag,
      target,
      rules: loadContextPermissions(ctx),
    });
    if (verdict === "deny") {
      return {
        block: true,
        reason: `pi-guard: ${tag} access to ${displayTarget(target)} is denied`,
      };
    }
    if (verdict === "ask") return requestApproval(event.toolName, target, ctx);
    return undefined;
  });
  pi.on("tool_result", (event, _ctx) => {
    if (event.toolName !== "bash") return undefined;
    let changed = false;
    const content = event.content.map((block) => {
      if (block.type !== "text") return block;
      const text = truncateText(block.text, "pi-guard");
      if (text === block.text) return block;
      changed = true;
      return { ...block, text };
    });
    if (!changed) return undefined;
    return { content };
  });
  pi.on("session_start", (_event, ctx) => {
    const restored = resetSession(ctx.sessionManager);
    if (restored.diagnostic !== undefined) {
      ctx.ui.notify(`pi-guard: ${restored.diagnostic}`, "warning");
    }
    if (restored.veto !== undefined) {
      ctx.ui.notify(`pi-guard: ${restored.veto}`, "error");
    }
    const notify = (message: string) =>
      ctx.ui.notify(`pi-guard: ${message}`, "warning");
    replaceConfigModes(loadModesConfig(getAgentDir(), notify), notify);
    publishValues(ctx.sessionManager);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    dropSession(ctx.sessionManager);
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
          `pi-guard: mode ${session(ctx.sessionManager).mode} (${modeNames().join(", ")})`,
        );
        return;
      }
      await switchMode(ctx, raw);
    },
  });
  pi.registerShortcut(Key.alt("m"), {
    description: "Cycle plan/approval mode",
    handler: (ctx) =>
      switchMode(ctx, nextMode(session(ctx.sessionManager).mode)),
  });
}
