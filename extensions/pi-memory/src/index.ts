import { randomUUID } from "node:crypto";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type SessionBeforeCompactResult,
  compact as compactSession,
  convertToLlm,
  getAgentDir,
  serializeConversation,
} from "@earendil-works/pi-coding-agent";
import {
  calculateDollarCost,
  formatDollarCost,
  resolveModelPricing,
} from "@hollowheap/core/pricing";
import {
  USAGE_ENTRY_TYPE,
  recordTurnUsage,
  restoreSessionUsage,
} from "@hollowheap/core/usage";
import { showMarkdownPager } from "@hollowheap/tui/pager";
import {
  type MemoryConfig,
  isMemoryActive,
  loadMemoryConfig,
} from "./config.js";
import {
  MEMORY_CLEAR_TYPE,
  MEMORY_CONSUMED_TYPE,
  MEMORY_OBSERVATION_TYPE,
  type MemoryLedger,
  type MemoryObservation,
  emptyMemoryLedger,
  memoryFromEntries,
  pendingMessageEntries,
  renderMemory,
} from "./ledger.js";
import { observeConversation } from "./observer.js";
import { redactSecrets } from "./redact.js";

const MAX_OBSERVER_CHARS = 120_000;
const MAX_OBSERVATION_CHARS = 500;

export interface MemoryExtensionDeps {
  getAgentDir?: () => string;
  observe?: typeof observeConversation;
  compact?: typeof compactSession;
}

function observationId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function stringHeaders(
  headers: Record<string, string | null> | undefined,
): Record<string, string> | undefined {
  if (headers === undefined) return undefined;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

function messageEntryIds(entries: readonly unknown[]): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const typed = entry as { type?: unknown; id?: unknown };
    if (typed.type === "message" && typeof typed.id === "string") {
      ids.push(typed.id);
    }
  }
  return ids;
}

function serializePending(
  pending: ReturnType<typeof pendingMessageEntries>,
  maxChars: number,
): {
  text: string;
  entries: ReturnType<typeof pendingMessageEntries>;
} {
  const entries: ReturnType<typeof pendingMessageEntries> = [];
  let text = "";
  for (const entry of pending) {
    const part = serializeConversation(convertToLlm([entry.message]));
    if (part.trim() === "") {
      entries.push(entry);
      continue;
    }
    const addition = text === "" ? part : `\n\n${part}`;
    if (text !== "" && text.length + addition.length > maxChars) break;
    text += addition;
    entries.push(entry);
    if (text.length >= maxChars) {
      text = text.slice(0, maxChars);
      break;
    }
  }
  return { text, entries };
}

function renderView(ledger: MemoryLedger): string {
  const lines = ["# Memory", ""];
  if (ledger.reflections.length > 0) {
    lines.push("## Reflections", "");
    for (const reflection of ledger.reflections) {
      lines.push(`- ${reflection.text}`);
    }
    lines.push("");
  }
  lines.push(`## Observations (${ledger.observations.length})`, "");
  for (const observation of ledger.observations) {
    lines.push(
      `- \`${observation.id}\` (${observation.relevance}) ${observation.text}`,
    );
  }
  return lines.join("\n").trim();
}

export function createMemoryExtension(
  deps: MemoryExtensionDeps = {},
): (pi: ExtensionAPI) => void {
  const resolveAgentDir = deps.getAgentDir ?? getAgentDir;
  const observe = deps.observe ?? observeConversation;
  const compact = deps.compact ?? compactSession;

  return (pi: ExtensionAPI): void => {
    if (process.env.PI_ACP) return;

    let ledger = emptyMemoryLedger();
    let observing = false;
    let observerAbort: AbortController | undefined;
    let generation = 0;
    let lastUsage:
      | { model: string; input: number; output: number; cost: number }
      | undefined;

    const loadConfig = (): MemoryConfig => loadMemoryConfig(resolveAgentDir());

    const abortObserver = (): void => {
      generation++;
      observerAbort?.abort();
      observerAbort = undefined;
      observing = false;
    };

    const restore = (ctx: ExtensionContext): void => {
      abortObserver();
      lastUsage = undefined;
      try {
        ledger = memoryFromEntries(ctx.sessionManager.getBranch());
      } catch {
        ledger = emptyMemoryLedger();
      }
    };

    const recordUsage = (
      ctx: ExtensionContext,
      model: { id?: string },
      usage: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        cost?: { total?: number };
      },
    ): void => {
      const pricing = resolveModelPricing(model);
      const reportedCost = usage.cost?.total;
      const cost =
        typeof reportedCost === "number" && Number.isFinite(reportedCost)
          ? reportedCost
          : pricing
            ? calculateDollarCost(
                {
                  input: usage.input,
                  output: usage.output,
                  cacheRead: usage.cacheRead,
                  cacheWrite: usage.cacheWrite,
                },
                pricing,
              )
            : 0;
      const next = recordTurnUsage(
        restoreSessionUsage(ctx.sessionManager),
        {
          input: usage.input,
          output: usage.output,
          cacheRead: usage.cacheRead,
          cacheWrite: usage.cacheWrite,
        },
        cost,
        model.id ?? "memory",
      );
      pi.appendEntry(USAGE_ENTRY_TYPE, next);
      pi.events?.emit?.("usage:refresh", undefined);
      lastUsage = {
        model: model.id ?? "memory",
        input: usage.input,
        output: usage.output,
        cost,
      };
    };

    const maybeObserve = async (ctx: ExtensionContext): Promise<void> => {
      if (observing) return;
      const config = loadConfig();
      if (!isMemoryActive(config)) return;
      if (ledger.observations.length >= config.maxObservations) return;
      const remaining = config.maxObservations - ledger.observations.length;
      let pending: ReturnType<typeof pendingMessageEntries>;
      let serialized: string;
      try {
        const branch = ctx.sessionManager.getBranch();
        pending = pendingMessageEntries(branch, ledger.consumedIds);
        if (pending.length === 0) return;
        serialized = serializeConversation(
          convertToLlm(pending.map((entry) => entry.message)),
        );
      } catch {
        return;
      }
      if (serialized.trim() === "") return;
      if (estimateTokens(serialized) < config.observeAfterTokens) return;

      const [provider, ...rest] = config.model.split("/");
      const modelId = rest.join("/");
      if (!provider || !modelId) return;
      const model = ctx.modelRegistry.find(provider, modelId);
      if (model === undefined) return;

      const contextWindow =
        typeof model.contextWindow === "number" && model.contextWindow > 0
          ? model.contextWindow
          : undefined;
      const existingChars = ledger.observations
        .slice(-20)
        .reduce((total, item) => total + item.text.length + 2, 0);
      const maxChars =
        contextWindow === undefined
          ? MAX_OBSERVER_CHARS
          : Math.min(
              MAX_OBSERVER_CHARS,
              Math.max(2_000, contextWindow * 4 - existingChars - 6_000),
            );
      const chunk = serializePending(pending, maxChars);
      if (chunk.text.trim() === "") {
        const ids = pending.map((entry) => entry.id);
        pi.appendEntry(MEMORY_CONSUMED_TYPE, { sourceEntryIds: ids });
        for (const id of ids) ledger.consumedIds.add(id);
        return;
      }
      const entryIds = chunk.entries.map((entry) => entry.id);
      const conversation = chunk.text;
      const startGeneration = generation;
      const controller = new AbortController();
      observerAbort = controller;
      observing = true;
      try {
        const result = await observe({
          registry: ctx.modelRegistry,
          model,
          conversation,
          existing: ledger.observations.map((item) => item.text),
          remaining,
          redact: config.redactSecrets,
          signal: controller.signal,
        });
        if (startGeneration !== generation || controller.signal.aborted) return;
        if (result.observations.length === 0) {
          pi.appendEntry(MEMORY_CONSUMED_TYPE, { sourceEntryIds: entryIds });
        } else {
          const createdAt = Date.now();
          const observations: MemoryObservation[] = result.observations.map(
            (observation) => ({
              id: observationId(),
              text: observation.text.slice(0, MAX_OBSERVATION_CHARS),
              relevance: observation.relevance,
              createdAt,
              sourceEntryIds: entryIds,
            }),
          );
          for (const observation of observations) {
            pi.appendEntry(MEMORY_OBSERVATION_TYPE, observation);
            ledger.observations.push(observation);
          }
        }
        for (const id of entryIds) ledger.consumedIds.add(id);
        if (result.usage !== undefined) {
          recordUsage(ctx, model, result.usage);
        }
      } catch (error) {
        if (
          startGeneration === generation &&
          config.notifyErrors &&
          ctx.hasUI &&
          !controller.signal.aborted
        ) {
          ctx.ui.notify(
            `pi-memory: ${
              error instanceof Error ? error.message : String(error)
            }`,
            "warning",
          );
        }
      } finally {
        if (observerAbort === controller) {
          observerAbort = undefined;
          observing = false;
        }
      }
    };

    pi.on("session_start", (_event, ctx) => {
      restore(ctx);
    });

    pi.on("session_tree", (_event, ctx) => {
      restore(ctx);
    });

    pi.on("session_shutdown", () => {
      abortObserver();
      ledger = emptyMemoryLedger();
      lastUsage = undefined;
    });

    pi.on("agent_settled", (event, ctx) => {
      if (event.aborted) return;
      void maybeObserve(ctx).catch(() => {});
    });

    pi.on(
      "session_before_compact",
      async (event, ctx): Promise<SessionBeforeCompactResult | undefined> => {
        const config = loadConfig();
        if (!isMemoryActive(config)) return undefined;
        const rendered = renderMemory(ledger, {
          maxTokens: config.injectionTokens,
        });
        if (rendered === "") return undefined;
        const memory = config.redactSecrets
          ? redactSecrets(rendered)
          : rendered;
        const model = ctx.model;
        if (model === undefined) return undefined;

        const memoryInstructions = `Preserve these durable memory facts from earlier in the session. Include them verbatim in the summary when they remain relevant.\n\n${memory}`;
        const customInstructions = event.customInstructions
          ? `${event.customInstructions}\n\n${memoryInstructions}`
          : memoryInstructions;
        try {
          const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
          if (!auth.ok) return undefined;
          const result = await compact(
            event.preparation,
            model,
            auth.apiKey,
            stringHeaders(auth.headers),
            customInstructions,
            event.signal,
          );
          return { compaction: result };
        } catch (error) {
          if (config.notifyErrors && ctx.hasUI) {
            ctx.ui.notify(
              `pi-memory: compaction failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
              "warning",
            );
          }
          return undefined;
        }
      },
    );

    pi.registerCommand("memory", {
      description:
        "Observational memory: /memory status, /memory view, /memory clear",
      getArgumentCompletions: (prefix: string) => {
        const value = prefix.trimStart().toLowerCase();
        return ["status", "view", "clear"]
          .filter((action) => action.startsWith(value))
          .map((action) => ({ value: action, label: action }));
      },
      handler: async (args, ctx) => {
        const [action = "status"] = args.trim().split(/\s+/).filter(Boolean);
        if (action === "status") {
          await showStatus(ctx);
          return;
        }
        if (action === "view") {
          await showView(ctx);
          return;
        }
        if (action === "clear") {
          await clearMemory(ctx);
          return;
        }
        if (ctx.hasUI) {
          ctx.ui.notify("Usage: /memory status|view|clear", "info");
        }
      },
    });

    const showStatus = async (ctx: ExtensionCommandContext): Promise<void> => {
      const config = loadConfig();
      const branch = ctx.sessionManager.getBranch();
      const pending = pendingMessageEntries(branch, ledger.consumedIds);
      const pendingText = pending.length
        ? serializeConversation(
            convertToLlm(pending.map((entry) => entry.message)),
          )
        : "";
      const lines = [
        `pi-memory: ${isMemoryActive(config) ? "enabled" : "disabled"}`,
        config.model === "" ? "model: none" : `model: ${config.model}`,
        `observations: ${ledger.observations.length}/${config.maxObservations}`,
        `reflections: ${ledger.reflections.length}`,
        `pending: ${pending.length} messages, ~${estimateTokens(pendingText)} tokens`,
        `observe after: ${config.observeAfterTokens} tokens`,
        lastUsage
          ? `last observer: ${lastUsage.model}, ${lastUsage.input + lastUsage.output} tokens, ${formatDollarCost(lastUsage.cost)}`
          : "last observer: none",
      ];
      if (config.diagnostics.length > 0) {
        lines.push("diagnostics:", ...config.diagnostics);
      }
      const text = lines.join("\n");
      if (ctx.hasUI) ctx.ui.notify(text, "info");
      else console.log(text);
    };

    const showView = async (ctx: ExtensionCommandContext): Promise<void> => {
      if (ledger.observations.length === 0 && ledger.reflections.length === 0) {
        if (ctx.hasUI) ctx.ui.notify("pi-memory: no memory recorded", "info");
        return;
      }
      const markdown = renderView(ledger);
      await showMarkdownPager(ctx, {
        title: "Memory",
        markdown,
        plainText: markdown,
      });
    };

    const clearMemory = async (ctx: ExtensionCommandContext): Promise<void> => {
      if (ledger.observations.length === 0 && ledger.reflections.length === 0) {
        if (ctx.hasUI) ctx.ui.notify("pi-memory: no memory to clear", "info");
        return;
      }
      if (
        ctx.hasUI &&
        !(await ctx.ui.confirm(
          "Clear memory?",
          "Remove all observations and reflections from this session?",
        ))
      ) {
        return;
      }
      abortObserver();
      const entryIds = messageEntryIds(ctx.sessionManager.getBranch());
      pi.appendEntry(MEMORY_CLEAR_TYPE, {
        clearedAt: Date.now(),
        sourceEntryIds: entryIds,
      });
      ledger = {
        observations: [],
        reflections: [],
        consumedIds: new Set([...ledger.consumedIds, ...entryIds]),
      };
      if (ctx.hasUI) ctx.ui.notify("pi-memory: cleared", "info");
    };
  };
}

export default function (pi: ExtensionAPI): void {
  createMemoryExtension()(pi);
}
