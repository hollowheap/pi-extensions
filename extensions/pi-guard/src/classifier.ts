import type {
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { errorMessage } from "@hollowheap/core/format";
import type { Tag } from "@hollowheap/core/types";
import { readToolTarget } from "@hollowheap/policy";

export type ClassifierVerdict =
  | { kind: "block" }
  | { kind: "error"; detail: string };

export async function classifyToolCall(
  event: ToolCallEvent,
  tag: Tag | undefined,
  ctx: ExtensionContext,
): Promise<ClassifierVerdict | undefined> {
  const registry = (ctx as { modelRegistry?: unknown }).modelRegistry as
    | {
        findOfType?: (...args: unknown[]) => unknown;
        classify?: (...args: unknown[]) => Promise<unknown>;
      }
    | undefined;
  if (
    typeof registry?.findOfType !== "function" ||
    typeof registry.classify !== "function"
  ) {
    return undefined;
  }
  let model: unknown;
  try {
    model = registry.findOfType("classifier", "typesafe", "jev-latest");
  } catch (error) {
    return {
      kind: "error",
      detail: errorMessage(error),
    };
  }
  if (model === undefined || model === null) return undefined;

  const target = readToolTarget(event.toolName, event.input) ?? event.toolName;
  const payload = {
    state: {
      tool: event.toolName,
      tag: tag ?? "unknown",
      summary: target.slice(0, 80),
    },
    questions: {
      answer: {
        type: "choice",
        instructions: `Allow ${event.toolName} (${tag ?? "unknown"})?`,
        criteria: {
          allow: "Proceed with the standard guard decision",
          block: "Block this tool call",
        },
      },
    },
  };

  let result: unknown;
  try {
    result = await registry.classify(model, payload);
  } catch (error) {
    return {
      kind: "error",
      detail: errorMessage(error),
    };
  }
  const record = result as
    | {
        stopReason?: unknown;
        errorMessage?: unknown;
        answers?: Record<string, unknown>;
      }
    | undefined;
  if (record?.stopReason === "error" || record?.stopReason === "aborted") {
    return {
      kind: "error",
      detail:
        typeof record.errorMessage === "string"
          ? record.errorMessage
          : String(record.stopReason),
    };
  }
  const answer = record?.answers?.answer;
  const choice =
    typeof answer === "string"
      ? answer
      : (answer as { choice?: unknown } | undefined)?.choice;
  return choice === "block" ? { kind: "block" } : undefined;
}
