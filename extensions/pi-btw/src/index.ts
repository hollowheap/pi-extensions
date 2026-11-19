import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  type AssistantMessage,
  type Message,
  contentText,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { errorMessage, sanitizeTerminalText } from "@hollowheap/core/format";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { hostUi, inputDialog, notify } from "@hollowheap/pi-ui/host";
import { showMarkdownPager } from "@hollowheap/pi-ui/pager";

const MAX_RESPONSE_TOKENS = 1200;
const MAX_PROMPT_CHARS = 4000;

const SYSTEM_PROMPT =
  "You are answering a side question about an ongoing coding session. " +
  "Use the conversation as context, do not call tools, and do not modify files. " +
  "Answer concisely in Markdown. If the context is insufficient, say so.";

export function buildBtwMessages(
  messages: readonly AgentMessage[],
  question: string,
): Message[] {
  return [
    ...convertToLlm([...messages]),
    {
      role: "user",
      content: [{ type: "text", text: question }],
      timestamp: Date.now(),
    },
  ];
}

export function responseText(response: AssistantMessage): string {
  return contentText(response.content).trim();
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || /abort|timeout/i.test(error.message);
}

async function answer(
  ctx: ExtensionCommandContext,
  question: string,
  signal: AbortSignal,
): Promise<void> {
  const model = ctx.model;
  if (model === undefined) {
    notify(ctx, "pi-btw: no active model", "warning");
    return;
  }

  const projection = ctx.sessionManager.buildSessionProjection();
  const messages = buildBtwMessages(projection.messages, question);
  const response = await ctx.modelRegistry.complete(
    model,
    { systemPrompt: SYSTEM_PROMPT, messages },
    {
      maxTokens: MAX_RESPONSE_TOKENS,
      signal,
      cacheRetention: "none",
      sessionId: randomUUID(),
    },
  );

  if (response.stopReason === "error") {
    throw new Error(response.errorMessage || response.stopReason);
  }
  if (response.stopReason === "aborted") {
    return;
  }

  const text = responseText(response);
  if (text === "") {
    notify(ctx, "pi-btw: model returned no text", "warning");
    return;
  }

  const markdown = `**Question:** ${sanitizeTerminalText(question)}\n\n${sanitizeTerminalText(text)}`;
  await showMarkdownPager(ctx, {
    title: `/btw ${sanitizeTerminalText(question)}`,
    markdown,
    plainText: `Question: ${sanitizeTerminalText(question)}\n\n${sanitizeTerminalText(text)}`,
  });
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("btw", {
    description: "Ask a one-shot side question using the current context",
    handler: async (args, ctx) => {
      let question = args.trim();
      if (
        question === "" &&
        ctx.hasUI &&
        typeof hostUi(ctx).input === "function"
      ) {
        question =
          (
            await withPromptLock(
              () => inputDialog(ctx, "Ask a side question", "Question"),
              { signal: ctx.signal },
            )
          )?.trim() ?? "";
      }
      if (question === "") {
        if (ctx.hasUI) notify(ctx, "Usage: /btw <question>", "info");
        return;
      }
      if (question.length > MAX_PROMPT_CHARS) {
        notify(
          ctx,
          `pi-btw: question exceeds ${MAX_PROMPT_CHARS} characters`,
          "warning",
        );
        return;
      }

      const controller = new AbortController();
      const onHostAbort = () => controller.abort();
      ctx.signal?.addEventListener("abort", onHostAbort, { once: true });
      const disposeTerminalInput = hostUi(ctx).onTerminalInput?.(
        (data: string) => {
          if (data === "\x1b" || data === "\x03") {
            controller.abort();
            return { consume: true };
          }
          return undefined;
        },
      );

      hostUi(ctx).setStatus?.("btw", "thinking");
      try {
        await answer(ctx, question, controller.signal);
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) return;
        notify(
          ctx,
          `pi-btw: ${sanitizeTerminalText(errorMessage(error))}`,
          "error",
        );
      } finally {
        disposeTerminalInput?.();
        ctx.signal?.removeEventListener("abort", onHostAbort);
        hostUi(ctx).setStatus?.("btw", undefined);
      }
    },
  });
}
