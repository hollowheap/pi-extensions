import {
  type ExtensionAPI,
  type ExtensionContext,
  type SessionBeforeCompactEvent,
  type SessionBeforeCompactResult,
  type compact as compactSession,
  convertToLlm,
  serializeConversation,
} from "@earendil-works/pi-coding-agent";
import { errorMessage } from "@hollowheap/core/format";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { readBranchEntries } from "@hollowheap/core/state";
import {
  type StatuslinePublisher,
  createStatuslinePublisher,
} from "@hollowheap/core/statusline";
import { recordAuxiliaryUsage } from "@hollowheap/core/usage";
import { notify } from "@hollowheap/pi-ui/host";
import { compactFromMemory, stringHeaders } from "./compaction.js";
import {
  MEMORY_CONSUMED_TYPE,
  MEMORY_OBSERVATION_TYPE,
  type MemoryLedger,
  type MemoryObservation,
  emptyMemoryLedger,
  memoryFromEntries,
  observationId,
  pendingMessageEntries,
  renderMemory,
} from "./ledger.js";
import type { observeConversation } from "./observer.js";
import { redactSecrets } from "./redact.js";
import {
  type MemoryConfig,
  isMemoryActive,
  loadMemoryConfig,
} from "./settings.js";
import {
  MAX_OBSERVATION_CHARS,
  type WorkspaceObservation,
  appendWorkspaceObservations,
  readWorkspaceObservations,
  trustedWorkspaceRoot,
} from "./workspace.js";

const MAX_OBSERVER_CHARS = 120_000;

export interface MemoryUsageSummary {
  model: string;
  input: number;
  output: number;
  cost: number;
}

export interface MemoryState {
  readonly pi: ExtensionAPI;
  readonly getAgentDir: () => string;
  readonly observe: typeof observeConversation;
  readonly compact: typeof compactSession;
  ledger: MemoryLedger;
  observing: boolean;
  observerAbort: AbortController | undefined;
  generation: number;
  consecutiveFailures: number;
  lastNotifiedError: string | undefined;
  lastObserverUsage: MemoryUsageSummary | undefined;
  lastCompactionUsage: MemoryUsageSummary | undefined;
  lastStatusText: string;
  statusline: StatuslinePublisher;
}

export function createMemoryState(options: {
  pi: ExtensionAPI;
  getAgentDir: () => string;
  observe: typeof observeConversation;
  compact: typeof compactSession;
}): MemoryState {
  const state: MemoryState = {
    pi: options.pi,
    getAgentDir: options.getAgentDir,
    observe: options.observe,
    compact: options.compact,
    ledger: emptyMemoryLedger(),
    observing: false,
    observerAbort: undefined,
    generation: 0,
    consecutiveFailures: 0,
    lastNotifiedError: undefined,
    lastObserverUsage: undefined,
    lastCompactionUsage: undefined,
    lastStatusText: "",
    statusline: undefined as unknown as StatuslinePublisher,
  };
  state.statusline = createStatuslinePublisher(
    options.pi.events,
    "memory",
    () => state.lastStatusText,
  );
  return state;
}

function memoryStatusText(ledger: MemoryLedger): string {
  const obs = ledger.observations.length;
  const ref = ledger.reflections.length;
  if (obs === 0 && ref === 0) return "";
  if (obs > 0 && ref > 0) return `${obs} obs, ${ref} ref`;
  if (obs > 0) return `${obs} obs`;
  return `${ref} ref`;
}

export function publishStatusline(state: MemoryState, text: string): void {
  state.lastStatusText = text;
  state.statusline.publish(text);
}

export function publishMemory(state: MemoryState, ctx: ExtensionContext): void {
  const branch = readBranchEntries(ctx.sessionManager) ?? [];
  const pending = pendingMessageEntries(branch, state.ledger.consumedIds);
  const latest =
    state.ledger.observations.length > 0
      ? state.ledger.observations[state.ledger.observations.length - 1]
      : undefined;

  publishStatusline(state, memoryStatusText(state.ledger));

  if (ctx.sessionManager) {
    updateSessionSnapshot(ctx.sessionManager, "memory", {
      observations: state.ledger.observations.length,
      reflections: state.ledger.reflections.length,
      unconsumed: pending.length,
      latestObservation: latest?.text,
      updatedAt: Date.now(),
    });
  }
}

export function loadConfig(state: MemoryState): MemoryConfig {
  return loadMemoryConfig(state.getAgentDir());
}

export function workspaceObservations(
  ctx: ExtensionContext,
  config: MemoryConfig,
): WorkspaceObservation[] {
  const workspace = trustedWorkspaceRoot(ctx);
  return workspace ? readWorkspaceObservations(workspace, config) : [];
}

export function saveToWorkspace(
  ctx: ExtensionContext,
  observations: readonly MemoryObservation[],
  config: MemoryConfig,
): void {
  const workspace = trustedWorkspaceRoot(ctx);
  const sessionOrigin = ctx.sessionManager?.getSessionId?.();
  if (!workspace || !sessionOrigin) return;
  try {
    appendWorkspaceObservations(workspace, sessionOrigin, observations, config);
  } catch {
    if (config.notifyErrors && ctx.hasUI) {
      notify(
        ctx,
        "pi-memory: could not save workspace observations",
        "warning",
      );
    }
  }
}

export function abortObserver(state: MemoryState): void {
  state.generation++;
  state.observerAbort?.abort();
  state.observerAbort = undefined;
  state.observing = false;
}

export function restoreMemory(state: MemoryState, ctx: ExtensionContext): void {
  abortObserver(state);
  state.lastObserverUsage = undefined;
  state.lastCompactionUsage = undefined;
  state.consecutiveFailures = 0;
  state.lastNotifiedError = undefined;
  try {
    state.ledger = memoryFromEntries(ctx.sessionManager.getBranch());
  } catch {
    state.ledger = emptyMemoryLedger();
  }
  publishMemory(state, ctx);
}

export function resetMemory(state: MemoryState): void {
  abortObserver(state);
  state.ledger = emptyMemoryLedger();
  state.lastObserverUsage = undefined;
  state.lastCompactionUsage = undefined;
  state.consecutiveFailures = 0;
  state.lastNotifiedError = undefined;
  publishStatusline(state, "");
}

function recordUsage(
  state: MemoryState,
  ctx: ExtensionContext,
  model: { id?: string },
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost?: { total?: number };
  },
): MemoryUsageSummary {
  const modelId = model.id ?? "memory";
  const { cost } = recordAuxiliaryUsage({
    sessionManager: ctx.sessionManager,
    context: ctx,
    modelId,
    model,
    usage,
    appendEntry: (customType, data) => {
      state.pi.appendEntry(customType, data);
    },
    emitEvent: (event, data) => {
      state.pi.events?.emit?.(event, data);
    },
  });
  return {
    model: modelId,
    input: usage.input,
    output: usage.output,
    cost,
  };
}

function assistantOutputTokens(
  entry: ReturnType<typeof pendingMessageEntries>[number],
  serializedPart: string,
): number {
  const message = entry.message as {
    role?: unknown;
    usage?: { output?: unknown };
  };
  if (message.role !== "assistant") return 0;
  const reported = message.usage?.output;
  if (
    typeof reported === "number" &&
    Number.isFinite(reported) &&
    reported > 0
  ) {
    return Math.trunc(reported);
  }
  return Math.ceil(serializedPart.length / 4);
}

function serializePending(
  pending: ReturnType<typeof pendingMessageEntries>,
  maxChars: number,
  observeAfterTokens: number,
): {
  text: string;
  entries: ReturnType<typeof pendingMessageEntries>;
  tokens: number;
} {
  const entries: ReturnType<typeof pendingMessageEntries> = [];
  let text = "";
  let totalChars = 0;
  let outputTokens = 0;
  let hasAssistant = false;
  let chunkFull = false;
  for (const entry of pending) {
    const part = serializeConversation(convertToLlm([entry.message]));
    if (part.trim() === "") {
      if (!chunkFull) entries.push(entry);
      continue;
    }
    totalChars += totalChars === 0 ? part.length : part.length + 2;
    if ((entry.message as { role?: unknown }).role === "assistant") {
      hasAssistant = true;
      outputTokens += assistantOutputTokens(entry, part);
    }
    if (!chunkFull) {
      const addition = text === "" ? part : `\n\n${part}`;
      if (text !== "" && text.length + addition.length > maxChars) {
        chunkFull = true;
      } else {
        text += addition;
        entries.push(entry);
        if (text.length >= maxChars) {
          text = text.slice(0, maxChars);
          chunkFull = true;
        }
      }
    }
    const checkpointTokens = hasAssistant
      ? outputTokens
      : Math.ceil(totalChars / 4);
    if (chunkFull && checkpointTokens >= observeAfterTokens) {
      break;
    }
  }
  return {
    text,
    entries,
    tokens: hasAssistant ? outputTokens : Math.ceil(totalChars / 4),
  };
}

export async function maybeObserve(
  state: MemoryState,
  ctx: ExtensionContext,
  options?: { force?: boolean },
): Promise<void> {
  if (state.observing) return;
  const config = loadConfig(state);
  if (!isMemoryActive(config)) return;
  if (state.ledger.observations.length >= config.maxObservations) return;
  const remaining = config.maxObservations - state.ledger.observations.length;

  let pending: ReturnType<typeof pendingMessageEntries>;
  try {
    const branch = ctx.sessionManager.getBranch();
    pending = pendingMessageEntries(branch, state.ledger.consumedIds);
  } catch {
    return;
  }
  if (pending.length === 0) return;

  const [provider, ...rest] = config.model.split("/");
  const modelId = rest.join("/");
  if (!provider || !modelId) return;
  const model = ctx.modelRegistry.find(provider, modelId);
  if (model === undefined) return;

  const contextWindow =
    typeof model.contextWindow === "number" && model.contextWindow > 0
      ? model.contextWindow
      : undefined;
  const existingChars = state.ledger.observations
    .slice(-20)
    .reduce((total, item) => total + item.text.length + 2, 0);
  const maxChars =
    contextWindow === undefined
      ? MAX_OBSERVER_CHARS
      : Math.min(
          MAX_OBSERVER_CHARS,
          Math.max(2_000, contextWindow * 4 - existingChars - 6_000),
        );

  let chunk: ReturnType<typeof serializePending>;
  try {
    chunk = serializePending(pending, maxChars, config.observeAfterTokens);
  } catch {
    return;
  }
  if (chunk.text.trim() === "") return;
  if (!options?.force && chunk.tokens < config.observeAfterTokens) return;

  const entryIds = chunk.entries.map((entry) => entry.id);
  const startGeneration = state.generation;
  const controller = new AbortController();
  state.observerAbort = controller;
  state.observing = true;
  try {
    const result = await state.observe({
      registry: ctx.modelRegistry,
      model,
      conversation: chunk.text,
      existing: state.ledger.observations.map((item) => item.text),
      remaining,
      redact: config.redactSecrets,
      signal: controller.signal,
    });
    if (startGeneration !== state.generation || controller.signal.aborted) {
      return;
    }
    if (result.observations.length === 0) {
      state.pi.appendEntry(MEMORY_CONSUMED_TYPE, { sourceEntryIds: entryIds });
    } else {
      const createdAt = Date.now();
      const observations: MemoryObservation[] = result.observations.map(
        (observation) => ({
          id: observationId(),
          text: observation.text.slice(0, MAX_OBSERVATION_CHARS),
          relevance: observation.relevance,
          createdAt,
          sourceEntryIds: entryIds,
          coversUpToId: entryIds[entryIds.length - 1],
        }),
      );
      for (const observation of observations) {
        state.pi.appendEntry(MEMORY_OBSERVATION_TYPE, observation);
        state.ledger.observations.push(observation);
      }
      saveToWorkspace(ctx, observations, config);
    }
    for (const id of entryIds) state.ledger.consumedIds.add(id);
    state.consecutiveFailures = 0;
    state.lastNotifiedError = undefined;
    if (result.usage !== undefined) {
      state.lastObserverUsage = recordUsage(state, ctx, model, result.usage);
    }
    publishMemory(state, ctx);
  } catch (error) {
    state.consecutiveFailures += 1;
    const message = errorMessage(error);
    if (
      startGeneration === state.generation &&
      config.notifyErrors &&
      ctx.hasUI &&
      !controller.signal.aborted &&
      message !== state.lastNotifiedError
    ) {
      state.lastNotifiedError = message;
      notify(ctx, `pi-memory: ${message}`, "warning");
    }
    if (state.consecutiveFailures >= 2) {
      state.pi.appendEntry(MEMORY_CONSUMED_TYPE, { sourceEntryIds: entryIds });
      for (const id of entryIds) state.ledger.consumedIds.add(id);
      state.consecutiveFailures = 0;
      publishMemory(state, ctx);
    }
  } finally {
    if (state.observerAbort === controller) {
      state.observerAbort = undefined;
      state.observing = false;
    }
  }
}

function isCompactionCancelled(
  state: MemoryState,
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
  startGeneration: number,
  startSession: string | undefined,
): boolean {
  return (
    signal?.aborted === true ||
    startGeneration !== state.generation ||
    startSession !== ctx.sessionManager.getSessionId?.()
  );
}

export async function handleBeforeCompact(
  state: MemoryState,
  event: SessionBeforeCompactEvent,
  ctx: ExtensionContext,
): Promise<SessionBeforeCompactResult | undefined> {
  const config = loadConfig(state);
  if (!isMemoryActive(config)) return undefined;
  if (config.deterministicCompaction) {
    const signal = event.signal;
    if (signal?.aborted === true) return { cancel: true };
    let compaction = compactFromMemory(event, config);
    if (compaction === undefined) {
      await maybeObserve(state, ctx, { force: true });
      if ((signal as { aborted?: boolean } | undefined)?.aborted === true) {
        return { cancel: true };
      }
      const refreshedBranch =
        ctx.sessionManager?.getBranch?.() ?? event.branchEntries;
      compaction = compactFromMemory(
        { ...event, branchEntries: refreshedBranch },
        config,
      );
    }
    if (compaction !== undefined) {
      state.lastCompactionUsage = undefined;
      return { compaction };
    }
  }
  const rendered = renderMemory(state.ledger, {
    maxTokens: config.injectionTokens,
  });
  if (rendered === "") return undefined;
  const memory = config.redactSecrets ? redactSecrets(rendered) : rendered;
  const model = ctx.model;
  if (model === undefined) return undefined;

  const memoryInstructions = `Preserve these durable memory facts from earlier in the session. Include them verbatim in the summary when they remain relevant.\n\n${memory}`;
  const customInstructions = event.customInstructions
    ? `${event.customInstructions}\n\n${memoryInstructions}`
    : memoryInstructions;
  const startGeneration = state.generation;
  const startSession = ctx.sessionManager.getSessionId?.();
  if (
    isCompactionCancelled(
      state,
      ctx,
      event.signal,
      startGeneration,
      startSession,
    )
  ) {
    return { cancel: true };
  }

  let result: Awaited<ReturnType<typeof compactSession>>;
  try {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (
      isCompactionCancelled(
        state,
        ctx,
        event.signal,
        startGeneration,
        startSession,
      )
    ) {
      return { cancel: true };
    }
    if (!auth.ok) return undefined;
    result = await state.compact(
      event.preparation,
      model,
      auth.apiKey,
      stringHeaders(auth.headers),
      customInstructions,
      event.signal,
    );
  } catch (error) {
    if (
      isCompactionCancelled(
        state,
        ctx,
        event.signal,
        startGeneration,
        startSession,
      )
    ) {
      return { cancel: true };
    }
    if (config.notifyErrors && ctx.hasUI) {
      notify(
        ctx,
        `pi-memory: compaction failed: ${errorMessage(error)}`,
        "warning",
      );
    }
    return undefined;
  }

  if (
    isCompactionCancelled(
      state,
      ctx,
      event.signal,
      startGeneration,
      startSession,
    )
  ) {
    return { cancel: true };
  }
  state.lastCompactionUsage = undefined;
  if (result.usage !== undefined) {
    try {
      state.lastCompactionUsage = recordUsage(state, ctx, model, result.usage);
    } catch (error) {
      if (config.notifyErrors && ctx.hasUI) {
        notify(
          ctx,
          `pi-memory: could not record compaction usage: ${errorMessage(error)}`,
          "warning",
        );
      }
    }
  }
  return { compaction: result };
}
