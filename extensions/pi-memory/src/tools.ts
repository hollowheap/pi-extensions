import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  sanitizeTerminalText,
  stringifyToolJson,
  toolTextResult,
} from "@hollowheap/core/format";
import { Type } from "typebox";
import {
  MEMORY_OBSERVATION_TYPE,
  type MemoryObservation,
  observationId,
} from "./ledger.js";
import { redactSecrets } from "./redact.js";
import { type MemoryConfig, isMemoryActive } from "./settings.js";
import {
  type MemoryState,
  loadConfig,
  publishMemory,
  saveToWorkspace,
  workspaceObservations,
} from "./state.js";
import { MAX_OBSERVATION_CHARS } from "./workspace.js";

function disabledResult(config: MemoryConfig) {
  const text = config.enabled
    ? "memory is disabled: observer model is not configured"
    : "memory is disabled";
  return toolTextResult(text);
}

function scoreMatch(text: string, terms: readonly string[]): number {
  const lower = text.toLowerCase();
  let total = 0;
  for (const term of terms) {
    let index = lower.indexOf(term);
    while (index !== -1) {
      total += 1;
      index = lower.indexOf(term, index + term.length);
    }
  }
  return total;
}

export function registerMemoryTools(state: MemoryState): void {
  const { pi } = state;

  pi.registerTool(
    defineTool({
      name: "memory_search",
      label: "memory_search",
      description:
        "Search session observations and reflections for durable facts from earlier in this session. Use when prior decisions, constraints, or context may matter.",
      exposure: "direct",
      parameters: Type.Object({
        query: Type.String({ minLength: 1 }),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        return runMemorySearch(state, params);
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "memory_recall",
      label: "memory_recall",
      description:
        "Recall durable observations with an explicit session or workspace scope. Available to codemode scripts only.",
      exposure: "codemode",
      parameters: Type.Object({
        query: Type.String({ minLength: 1 }),
        scope: Type.Optional(
          Type.Union([Type.Literal("session"), Type.Literal("workspace")]),
        ),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        return runMemoryRecall(state, params, ctx);
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "memory_remember",
      label: "memory_remember",
      description:
        "Store one durable fact or decision in session memory. Use for stable constraints or preferences, not transient details or secrets.",
      exposure: "direct",
      parameters: Type.Object({
        text: Type.String({ minLength: 1, maxLength: 500 }),
        relevance: Type.Optional(Type.Number({ minimum: 1, maximum: 5 })),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        return runMemoryRemember(state, params, ctx);
      },
    }),
  );
}

function runMemorySearch(
  state: MemoryState,
  params: { query: string; limit?: number },
) {
  const config = loadConfig(state);
  if (!isMemoryActive(config)) return disabledResult(config);
  const terms = params.query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches: Array<{
    kind: "observation" | "reflection";
    id: string;
    text: string;
    relevance: number;
    createdAt: number;
    score: number;
  }> = [];
  for (const item of state.ledger.observations) {
    const value = scoreMatch(item.text, terms);
    if (value > 0) {
      matches.push({
        kind: "observation",
        id: item.id,
        text: sanitizeTerminalText(item.text),
        relevance: item.relevance,
        createdAt: item.createdAt,
        score: value,
      });
    }
  }
  for (const item of state.ledger.reflections) {
    const value = scoreMatch(item.text, terms);
    if (value > 0) {
      matches.push({
        kind: "reflection",
        id: item.id,
        text: sanitizeTerminalText(item.text),
        relevance: 3,
        createdAt: item.createdAt,
        score: value,
      });
    }
  }
  matches.sort(
    (a, b) =>
      b.score - a.score ||
      b.relevance - a.relevance ||
      b.createdAt - a.createdAt,
  );
  const limit = params.limit ?? 5;
  const results = matches.slice(0, limit).map(({ score: _, ...item }) => item);
  return toolTextResult(
    stringifyToolJson({
      total: matches.length,
      results,
    }),
  );
}

function runMemoryRecall(
  state: MemoryState,
  params: { query: string; scope?: "session" | "workspace"; limit?: number },
  ctx: Parameters<typeof workspaceObservations>[0],
) {
  const config = loadConfig(state);
  if (!isMemoryActive(config)) return disabledResult(config);
  const scope = params.scope ?? "session";
  const terms = params.query.toLowerCase().split(/\s+/).filter(Boolean);
  const observations =
    scope === "workspace"
      ? workspaceObservations(ctx, config)
      : state.ledger.observations;
  const results = observations
    .filter((item) => {
      const lower = item.text.toLowerCase();
      return terms.some((term) => lower.includes(term));
    })
    .slice(0, params.limit ?? 5)
    .map((item) => {
      const sanitized = sanitizeTerminalText(item.text);
      return {
        id: item.id,
        scope,
        text: config.redactSecrets ? redactSecrets(sanitized) : sanitized,
        ...("workspace" in item
          ? {
              workspace: item.workspace,
              sessionOrigin: item.sessionOrigin,
              redacted: item.redacted,
            }
          : {}),
      };
    });
  return toolTextResult(
    stringifyToolJson({
      scope,
      total: results.length,
      results,
    }),
  );
}

function runMemoryRemember(
  state: MemoryState,
  params: { text: string; relevance?: number },
  ctx: Parameters<typeof saveToWorkspace>[0],
) {
  const config = loadConfig(state);
  if (!isMemoryActive(config)) return disabledResult(config);
  const normalized = params.text.replace(/\s+/g, " ").trim();
  if (normalized === "") {
    return toolTextResult("text is required");
  }
  const text = (
    config.redactSecrets ? redactSecrets(normalized) : normalized
  ).slice(0, MAX_OBSERVATION_CHARS);
  const existing = state.ledger.observations.find(
    (item) => item.text.toLowerCase() === text.toLowerCase(),
  );
  if (existing) {
    saveToWorkspace(ctx, [existing], config);
    return toolTextResult(
      stringifyToolJson({
        id: existing.id,
        duplicate: true,
      }),
    );
  }
  const observation: MemoryObservation = {
    id: observationId(),
    text,
    relevance: params.relevance ?? 3,
    createdAt: Date.now(),
    sourceEntryIds: [],
  };
  state.ledger.observations.push(observation);
  state.pi.appendEntry(MEMORY_OBSERVATION_TYPE, observation);
  saveToWorkspace(ctx, [observation], config);
  publishMemory(state, ctx);
  return toolTextResult(
    stringifyToolJson({
      id: observation.id,
      duplicate: false,
    }),
  );
}
