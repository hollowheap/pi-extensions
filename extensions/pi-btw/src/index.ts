import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { showMarkdownPager } from "@hollowheap/tui/pager";

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
  return response.content
    .filter(
      (item): item is { type: "text"; text: string } => item.type === "text",
    )
    .map((item) => item.text)
    .join("\n")
    .trim();
}

async function answer(
  ctx: ExtensionCommandContext,
  question: string,
): Promise<void> {
  const model = ctx.model;
  if (model === undefined) {
    ctx.ui.notify("pi-btw: no active model", "warning");
    return;
  }

  const projection = ctx.sessionManager.buildSessionProjection();
  const messages = buildBtwMessages(projection.messages, question);
  const response = await ctx.modelRegistry.complete(
    model,
    { systemPrompt: SYSTEM_PROMPT, messages },
    {
      maxTokens: MAX_RESPONSE_TOKENS,
      signal: ctx.signal,
      cacheRetention: "none",
      sessionId: randomUUID(),
    },
  );

  if (response.stopReason === "error" || response.stopReason === "aborted") {
    throw new Error(response.errorMessage || response.stopReason);
  }

  const text = responseText(response);
  if (text === "") {
    ctx.ui.notify("pi-btw: model returned no text", "warning");
    return;
  }

  await showMarkdownPager(ctx, {
    title: `/btw ${question}`,
    markdown: text,
    plainText: text,
  });
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("btw", {
    description: "Ask a one-shot side question using the current context",
    handler: async (args, ctx) => {
      let question = args.trim();
      if (question === "" && ctx.hasUI && typeof ctx.ui.input === "function") {
        question =
          (await ctx.ui.input("Ask a side question", "Question"))?.trim() ?? "";
      }
      if (question === "") {
        if (ctx.hasUI) ctx.ui.notify("Usage: /btw <question>", "info");
        return;
      }
      if (question.length > MAX_PROMPT_CHARS) {
        ctx.ui.notify(
          `pi-btw: question exceeds ${MAX_PROMPT_CHARS} characters`,
          "warning",
        );
        return;
      }

      ctx.ui.setStatus?.("btw", "thinking");
      try {
        await answer(ctx, question);
      } catch (error) {
        if (ctx.signal?.aborted) return;
        ctx.ui.notify(
          `pi-btw: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      } finally {
        ctx.ui.setStatus?.("btw", undefined);
      }
    },
  });
}
