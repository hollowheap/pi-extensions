import { resolve } from "node:path";
import {
  type ExtensionCommandContext,
  convertToLlm,
  serializeConversation,
} from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { formatDollarCost } from "@hollowheap/core/pricing";
import { confirmDialog, notify } from "@hollowheap/pi-ui/host";
import { prefixCompletions } from "@hollowheap/ui/autocomplete";
import { messageEntryIds } from "./compaction.js";
import {
  MEMORY_CLEAR_TYPE,
  type MemoryLedger,
  type MemoryObservation,
  estimateTokens,
  pendingMessageEntries,
  renderMemory,
  sourceEntryCoverage,
} from "./ledger.js";
import { migrateWorkspaceMemory } from "./migration.js";
import { redactSecrets } from "./redact.js";
import { isMemoryActive } from "./settings.js";
import {
  type MemoryState,
  type MemoryUsageSummary,
  abortObserver,
  loadConfig,
  maybeObserve,
  publishMemory,
  workspaceObservations,
} from "./state.js";
import { trustedWorkspaceRoot } from "./workspace.js";

function formatUsageSummary(
  kind: "observer" | "compaction",
  usage: MemoryUsageSummary | undefined,
): string {
  return usage
    ? `last ${kind}: ${usage.model}, ${usage.input + usage.output} tokens, ${formatDollarCost(usage.cost)}`
    : `last ${kind}: none`;
}

function renderView(
  ledger: Pick<MemoryLedger, "reflections"> & {
    observations: readonly Pick<
      MemoryObservation,
      "id" | "text" | "relevance"
    >[];
  },
  title: string,
): string {
  const lines = [`# ${title}`, ""];
  if (ledger.reflections.length > 0) {
    lines.push("## Reflections", "");
    for (const reflection of ledger.reflections) {
      lines.push(`- ${sanitizeTerminalText(reflection.text)}`);
    }
    lines.push("");
  }
  lines.push(`## Observations (${ledger.observations.length})`, "");
  for (const observation of ledger.observations) {
    lines.push(
      `- \`${observation.id}\` (${observation.relevance}) ${sanitizeTerminalText(observation.text)}`,
    );
  }
  return lines.join("\n").trim();
}

function reportCommandOutput(
  ctx: ExtensionCommandContext,
  message: string,
  level: "info" | "warning" | "error",
): void {
  if (ctx.hasUI) notify(ctx, message, level);
  else console.log(message);
}

async function migrateMemory(
  state: MemoryState,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const config = loadConfig(state);
  const workspace = trustedWorkspaceRoot(ctx);
  if (!isMemoryActive(config) || !workspace) {
    reportCommandOutput(
      ctx,
      "pi-memory: migration requires enabled memory in a trusted workspace",
      "warning",
    );
    return;
  }
  try {
    const file = ctx.sessionManager.getSessionFile?.();
    const { imported, skipped } = await migrateWorkspaceMemory(
      workspace,
      state.getAgentDir(),
      ctx.sessionManager.getSessionDir?.(),
      {
        file: file ? resolve(file) : undefined,
        id: ctx.sessionManager.getSessionId(),
        branch: file ? ctx.sessionManager.getBranch() : [],
      },
      config,
    );
    const message = `pi-memory: imported ${imported} workspace observations${skipped ? `, skipped ${skipped} unverified session sources` : ""}`;
    reportCommandOutput(ctx, message, "info");
  } catch {
    reportCommandOutput(
      ctx,
      "pi-memory: workspace migration could not finish",
      "warning",
    );
  }
}

function showStatus(
  state: MemoryState,
  ctx: ExtensionCommandContext,
  scope: "session" | "workspace",
): void {
  const config = loadConfig(state);
  const workspaceCount = workspaceObservations(ctx, config).length;
  const workspaceStatus = `workspace observations: ${workspaceCount}/${config.maxObservations}`;
  if (scope === "workspace") {
    reportCommandOutput(ctx, workspaceStatus, "info");
    return;
  }
  const branch = ctx.sessionManager.getBranch();
  const sources = messageEntryIds(branch);
  const { coveredIds } = sourceEntryCoverage(
    sources,
    state.ledger.observations,
  );
  const pending = pendingMessageEntries(branch, state.ledger.consumedIds);
  const pendingText = pending.length
    ? serializeConversation(convertToLlm(pending.map((entry) => entry.message)))
    : "";
  const lines = [
    `pi-memory: ${isMemoryActive(config) ? "enabled" : "disabled"}`,
    config.model === "" ? "model: none" : `model: ${config.model}`,
    `observations: ${state.ledger.observations.length}/${config.maxObservations}`,
    workspaceStatus,
    `coverage: ${coveredIds.size}/${sources.length} source entries`,
    `reflections: ${state.ledger.reflections.length}`,
    `pending: ${pending.length} messages, ~${estimateTokens(pendingText)} tokens`,
    `observe after: ${config.observeAfterTokens} tokens`,
    formatUsageSummary("observer", state.lastObserverUsage),
    formatUsageSummary("compaction", state.lastCompactionUsage),
  ];
  if (config.diagnostics.length > 0) {
    lines.push("diagnostics:", ...config.diagnostics);
  }
  reportCommandOutput(ctx, lines.join("\n"), "info");
}

async function showView(
  state: MemoryState,
  ctx: ExtensionCommandContext,
  scope: "session" | "workspace",
): Promise<void> {
  const view =
    scope === "workspace"
      ? {
          observations: workspaceObservations(ctx, loadConfig(state)),
          reflections: [],
        }
      : state.ledger;
  if (view.observations.length === 0 && view.reflections.length === 0) {
    if (ctx.hasUI) notify(ctx, "pi-memory: no memory recorded", "info");
    return;
  }
  const title = scope === "workspace" ? "Workspace Memory" : "Memory";
  const markdown = renderView(view, title);
  const { showMarkdownPager } = await import("@hollowheap/pi-ui/pager");
  await showMarkdownPager(ctx, {
    title,
    markdown,
    plainText: markdown,
  });
}

async function handoffMemory(
  state: MemoryState,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const config = loadConfig(state);
  const rendered = renderMemory(state.ledger, {
    maxTokens: config.injectionTokens,
  });
  if (rendered === "") {
    if (ctx.hasUI) notify(ctx, "pi-memory: no memory to hand off", "info");
    return;
  }
  const memory = config.redactSecrets ? redactSecrets(rendered) : rendered;
  const { showMarkdownPager } = await import("@hollowheap/pi-ui/pager");
  await showMarkdownPager(ctx, {
    title: "Memory handoff",
    markdown: memory,
    plainText: memory,
  });
  if (!ctx.hasUI) return;
  const confirmed = await confirmDialog(
    ctx,
    "Create handoff branch?",
    "Fork a new session seeded with this memory block?",
  );
  if (!confirmed) {
    notify(ctx, "pi-memory: handoff cancelled", "info");
    return;
  }
  const branch = ctx.sessionManager.getBranch();
  const lastEntry = branch[branch.length - 1];
  if (lastEntry === undefined || typeof lastEntry.id !== "string") {
    notify(ctx, "pi-memory: cannot fork (no session entry)", "error");
    return;
  }
  if (typeof ctx.fork !== "function") {
    notify(ctx, "pi-memory: fork not available", "error");
    return;
  }
  await ctx.fork(lastEntry.id, {
    position: "at",
    withSession: async (replacedCtx) => {
      notify(replacedCtx, "pi-memory: handoff branch created", "info");
    },
  });
}

async function clearMemory(
  state: MemoryState,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (
    state.ledger.observations.length === 0 &&
    state.ledger.reflections.length === 0
  ) {
    if (ctx.hasUI) notify(ctx, "pi-memory: no memory to clear", "info");
    return;
  }
  if (
    ctx.hasUI &&
    !(await confirmDialog(
      ctx,
      "Clear memory?",
      "Remove all observations and reflections from this session?",
    ))
  ) {
    return;
  }
  abortObserver(state);
  const entryIds = messageEntryIds(ctx.sessionManager.getBranch());
  state.pi.appendEntry(MEMORY_CLEAR_TYPE, {
    clearedAt: Date.now(),
    sourceEntryIds: entryIds,
  });
  state.ledger = {
    observations: [],
    reflections: [],
    consumedIds: new Set([...state.ledger.consumedIds, ...entryIds]),
  };
  publishMemory(state, ctx);
  if (ctx.hasUI) notify(ctx, "pi-memory: cleared", "info");
}

async function checkpointMemory(
  state: MemoryState,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const config = loadConfig(state);
  if (!isMemoryActive(config)) {
    reportCommandOutput(
      ctx,
      "pi-memory: checkpoint requires enabled memory with an observer model",
      "warning",
    );
    return;
  }
  await maybeObserve(state, ctx, { force: true });
  if (typeof ctx.compact === "function") {
    ctx.compact({
      onError: (error) => {
        if (ctx.hasUI) notify(ctx, `pi-memory: ${error.message}`, "warning");
      },
    });
  }
  reportCommandOutput(
    ctx,
    `pi-memory: checkpointed (${state.ledger.observations.length}/${config.maxObservations} observations)`,
    "info",
  );
}

function getMemoryArgumentCompletions(prefix: string) {
  const value = prefix.trimStart().toLowerCase();
  const scope = /^(status|view)\s+(\S*)$/.exec(value);
  if (scope) {
    return prefixCompletions(scope[2] ?? "", ["session", "workspace"]).map(
      ({ value: name, label }) => ({ value: `${scope[1]} ${name}`, label }),
    );
  }
  return prefixCompletions(value, [
    "status",
    "view",
    "checkpoint",
    "clear",
    "handoff",
    "migrate",
  ]);
}

export function registerMemoryCommands(state: MemoryState): void {
  state.pi.registerCommand("memory", {
    description:
      "Observational memory: /memory status|view [session|workspace], /memory checkpoint|clear|migrate",
    getArgumentCompletions: getMemoryArgumentCompletions,
    handler: async (args, ctx) => {
      const [action = "status", requestedScope, extra] = args
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const scope = requestedScope ?? "session";
      if (
        (action === "status" || action === "view") &&
        (scope === "session" || scope === "workspace") &&
        extra === undefined
      ) {
        if (action === "status") showStatus(state, ctx, scope);
        else await showView(state, ctx, scope);
        return;
      }
      if (action === "checkpoint" && requestedScope === undefined) {
        await checkpointMemory(state, ctx);
        return;
      }
      if (action === "clear") {
        await clearMemory(state, ctx);
        return;
      }
      if (action === "handoff") {
        await handoffMemory(state, ctx);
        return;
      }
      if (action === "migrate" && requestedScope === undefined) {
        await migrateMemory(state, ctx);
        return;
      }
      if (ctx.hasUI) {
        notify(
          ctx,
          "Usage: /memory status|view [session|workspace], /memory checkpoint|clear|migrate",
          "info",
        );
      }
    },
  });
}
