import { type JsonValue, contentText } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionToolContext,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import { errorMessage } from "@hollowheap/core/format";
import { notify } from "@hollowheap/pi-ui/host";
import { Type } from "typebox";

const MAX_BATCH_SIZE = 32;
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const toolName = Type.String({ minLength: 1 });
const toolArgs = Type.Record(Type.String(), Type.Unknown());
const boundedArray = { minItems: 1, maxItems: MAX_BATCH_SIZE };
const concurrency = Type.Optional(
  Type.Integer({ minimum: 1, maximum: MAX_CONCURRENCY }),
);

const batchCall = Type.Object({ tool: toolName, args: toolArgs });
const batchCallList = Type.Array(batchCall, boundedArray);

const batchParameters = Type.Union([
  batchCallList,
  Type.Object(
    {
      calls: batchCallList,
      concurrency,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { tool: toolName, args: Type.Array(toolArgs, boundedArray), concurrency },
    { additionalProperties: false },
  ),
]);

const batchResult = Type.Union([
  Type.Object({
    tool: toolName,
    status: Type.Literal("ok"),
    value: Type.Unknown(),
  }),
  Type.Object({
    tool: toolName,
    status: Type.Literal("error"),
    error: Type.String(),
  }),
  Type.Object({ tool: toolName, status: Type.Literal("cancelled") }),
]);

type BatchResult =
  | { tool: string; status: "ok"; value: JsonValue }
  | { tool: string; status: "error"; error: string }
  | { tool: string; status: "cancelled" };

function formatBatchResult(result: BatchResult): string {
  if (result.status === "error") {
    return `${result.tool}: error ${result.error}`;
  }
  if (result.status === "cancelled") return `${result.tool}: cancelled`;
  const value =
    typeof result.value === "string"
      ? result.value
      : JSON.stringify(result.value);
  return `${result.tool}: ok ${value ?? ""}`.trimEnd();
}

async function callBatchTool(
  { tool, args }: { tool: string; args: Record<string, unknown> },
  ctx: ExtensionToolContext,
  signal: AbortSignal | undefined,
): Promise<BatchResult> {
  if (tool === "batch" || tool === "codemode") {
    return { tool, status: "error", error: `Cannot call ${tool} from batch` };
  }
  try {
    const { result, isError } = await ctx.executeTool(tool, args, { signal });
    const text = contentText(result.content);
    if (!isError) {
      return {
        tool,
        status: "ok",
        value:
          result.structuredContent === undefined
            ? text
            : result.structuredContent,
      };
    }
    return signal?.aborted
      ? { tool, status: "cancelled" }
      : { tool, status: "error", error: text || `${tool} failed` };
  } catch (error) {
    return signal?.aborted
      ? { tool, status: "cancelled" }
      : {
          tool,
          status: "error",
          error: errorMessage(error),
        };
  }
}

const batch = defineTool({
  name: "batch",
  label: "Batch",
  description:
    "Run up to 32 independent tool calls. Pass [{ tool, args }, ...] directly, { calls: [{ tool, args }, ...] } for mixed tools with options, or { tool, args: [...] } for repeated calls to one tool. Returns one result per call in input order. Concurrency defaults to 4 and can be set from 1 to 8. Tool names are raw names from discovery.",
  exposure: "codemode",
  parameters: batchParameters,
  outputSchema: Type.Object({ results: Type.Array(batchResult) }),
  reachesTools: (input) => {
    if (Array.isArray(input)) {
      return input.flatMap((call) =>
        typeof call?.tool === "string" ? [call.tool] : [],
      );
    }
    if (typeof input !== "object" || input === null) return [];
    if (typeof input.tool === "string") return [input.tool];
    return Array.isArray(input.calls)
      ? input.calls.flatMap((call) =>
          typeof call?.tool === "string" ? [call.tool] : [],
        )
      : [];
  },
  async execute(_id, params, signal, _update, ctx) {
    const calls = Array.isArray(params)
      ? params
      : "calls" in params
        ? params.calls
        : params.args.map((args) => ({ tool: params.tool, args }));
    const results: BatchResult[] = calls.map(({ tool }) => ({
      tool,
      status: "cancelled",
    }));
    const requestedConcurrency = Array.isArray(params)
      ? undefined
      : params.concurrency;
    const limit = Math.min(
      requestedConcurrency ?? DEFAULT_CONCURRENCY,
      calls.length,
    );
    let nextIndex = 0;

    async function runCalls() {
      while (nextIndex < calls.length && !signal?.aborted) {
        const index = nextIndex++;
        results[index] = await callBatchTool(calls[index], ctx, signal);
      }
    }

    await Promise.all(Array.from({ length: limit }, runCalls));
    return {
      content: [
        { type: "text", text: `Batch finished (${calls.length} calls)` },
        ...results.map((result) => ({
          type: "text" as const,
          text: formatBatchResult(result),
        })),
      ],
      details: {},
      structuredContent: { results },
    };
  },
});

export function registerCodemodeTools(pi: ExtensionAPI) {
  const pending = new WeakMap<
    ExtensionContext["sessionManager"],
    { instructions?: string }
  >();

  pi.registerTool(batch);
  pi.registerTool(
    defineTool({
      name: "compact_context",
      label: "Compact context",
      description:
        "Request session-context compaction after the current agent run settles. Use optional instructions to name details the summary should retain. The tool returns a request status immediately.",
      exposure: "codemode",
      parameters: Type.Union([
        Type.String({
          maxLength: 4000,
          description: "Compaction instructions shorthand.",
        }),
        Type.Object({
          instructions: Type.Optional(Type.String({ maxLength: 4000 })),
        }),
      ]),
      outputSchema: Type.Object({
        status: Type.Union([
          Type.Literal("queued"),
          Type.Literal("already_queued"),
          Type.Literal("cancelled"),
        ]),
      }),
      async execute(_id, params, signal, _update, ctx) {
        const instructions =
          typeof params === "string" ? params : params.instructions;
        if (!ctx.sessionManager) {
          return {
            content: [
              {
                type: "text",
                text: "compact_context requires an active session.",
              },
            ],
            details: {},
          };
        }
        let status = "cancelled";
        if (!signal?.aborted) {
          if (pending.has(ctx.sessionManager)) {
            status = "already_queued";
          } else {
            pending.set(ctx.sessionManager, { instructions });
            status = "queued";
          }
        }
        return {
          content: [
            {
              type: "text",
              text: `Context compaction ${status.replace("_", " ")}`,
            },
          ],
          details: {},
          structuredContent: { status },
        };
      },
    }),
  );

  pi.on("agent_settled", (event, ctx) => {
    const request = pending.get(ctx.sessionManager);
    if (!request) return;
    pending.delete(ctx.sessionManager);
    if (event.aborted || !ctx.isIdle() || ctx.hasPendingMessages()) return;
    // Starting compaction before this event would abort the active agent run.
    ctx.compact({
      customInstructions: request.instructions,
      onError: (error) => {
        if (ctx.hasUI) notify(ctx, error.message, "warning");
      },
    });
  });
  return (ctx: ExtensionContext) => {
    pending.delete(ctx.sessionManager);
  };
}
