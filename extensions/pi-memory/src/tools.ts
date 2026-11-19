import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  sanitizeTerminalText,
  stringifyToolJson,
  toolTextResult,
} from "@hollowheap/core/format";
import { Type } from "typebox";
import { redactSecrets } from "./redact.js";
import { type MemoryConfig, isMemoryActive } from "./settings.js";
import {
  type MemoryState,
  loadConfig,
  workspaceObservations,
} from "./state.js";

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
      name: "recall",
      label: "recall",
      description:
        "Search observations and reflections for durable facts from earlier in this session or across the workspace. Use when prior decisions, constraints, or context may matter.",
      exposure: "direct",
      parameters: Type.Object({
        query: Type.String({ minLength: 1 }),
        scope: Type.Optional(
          Type.Union([Type.Literal("session"), Type.Literal("workspace")]),
        ),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        if (params.scope === "workspace") {
          return runWorkspaceRecall(state, params, ctx);
        }
        return runSessionRecall(state, params);
      },
    }),
  );
}

function runSessionRecall(
  state: MemoryState,
  params: { query: string; limit?: number },
) {
  const config = loadConfig(state);
  if (!isMemoryActive(config)) return disabledResult(config);
  const terms = params.query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches: Array<{
    kind: "observation" | "reflection";
    id: string;
    scope: "session";
    text: string;
    relevance: number;
    createdAt: number;
    score: number;
  }> = [];
  for (const item of state.ledger.observations) {
    const value = scoreMatch(item.text, terms);
    if (value > 0) {
      const sanitized = sanitizeTerminalText(item.text);
      matches.push({
        kind: "observation",
        id: item.id,
        scope: "session",
        text: config.redactSecrets ? redactSecrets(sanitized) : sanitized,
        relevance: item.relevance,
        createdAt: item.createdAt,
        score: value,
      });
    }
  }
  for (const item of state.ledger.reflections) {
    const value = scoreMatch(item.text, terms);
    if (value > 0) {
      const sanitized = sanitizeTerminalText(item.text);
      matches.push({
        kind: "reflection",
        id: item.id,
        scope: "session",
        text: config.redactSecrets ? redactSecrets(sanitized) : sanitized,
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
      scope: "session",
      total: matches.length,
      results,
    }),
  );
}

function runWorkspaceRecall(
  state: MemoryState,
  params: { query: string; limit?: number },
  ctx: Parameters<typeof workspaceObservations>[0],
) {
  const config = loadConfig(state);
  if (!isMemoryActive(config)) return disabledResult(config);
  const terms = params.query.toLowerCase().split(/\s+/).filter(Boolean);
  const observations = workspaceObservations(ctx, config);
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
        scope: "workspace" as const,
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
      scope: "workspace",
      total: results.length,
      results,
    }),
  );
}
