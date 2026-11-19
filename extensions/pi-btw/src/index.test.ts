import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import extension, { buildBtwMessages, responseText } from "./index.js";

const showMarkdownPager = vi.fn().mockResolvedValue(undefined);

vi.mock("@hollowheap/tui/pager", () => ({
  showMarkdownPager: (...args: unknown[]) => showMarkdownPager(...args),
}));

vi.mock("@hollowheap/core/prompt-lock", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, withPromptLock: vi.fn((fn: () => unknown) => fn()) };
});

type Command = {
  handler: (args: string, ctx: unknown) => Promise<void>;
};

function createPi() {
  let command: Command | undefined;
  return {
    registerCommand: vi.fn((_name: string, def: Command) => {
      command = def;
    }),
    getCommand: () => command,
  };
}

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    hasUI: true,
    signal: undefined,
    model: { provider: "test", id: "model" },
    modelRegistry: {
      complete: vi.fn().mockResolvedValue({
        role: "assistant",
        content: [{ type: "text", text: "Because the fixture is stale." }],
        stopReason: "end",
      }),
    },
    sessionManager: {
      buildSessionProjection: vi.fn(() => ({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Earlier context" }],
            timestamp: 1,
          },
        ],
      })),
    },
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      input: vi.fn().mockResolvedValue("typed question"),
      onTerminalInput: vi.fn(
        (_handler: (data: string) => { consume?: boolean } | undefined) =>
          vi.fn(),
      ),
    },
    ...overrides,
  };
}

beforeEach(() => {
  showMarkdownPager.mockClear();
  vi.mocked(withPromptLock).mockClear();
});

describe("pi-btw", () => {
  it("registers /btw", () => {
    const pi = createPi();
    extension(pi as never);
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "btw",
      expect.objectContaining({ handler: expect.any(Function) }),
    );
  });

  it("answers with the session projection without appending entries", async () => {
    const pi = createPi();
    extension(pi as never);
    const ctx = createCtx();

    await pi.getCommand()?.handler(" why? ", ctx as never);

    const complete = ctx.modelRegistry.complete;
    expect(complete).toHaveBeenCalledTimes(1);
    const [, context, options] = complete.mock.calls[0] as [
      unknown,
      { systemPrompt: string; messages: unknown[] },
      { maxTokens: number },
    ];
    expect(context.systemPrompt).toContain("side question");
    expect(context.messages).toHaveLength(2);
    expect(options.maxTokens).toBe(1200);
    expect(showMarkdownPager).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        title: "/btw why?",
        markdown: "**Question:** why?\n\nBecause the fixture is stale.",
      }),
    );
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("btw", undefined);
    expect("appendEntry" in pi).toBe(false);
  });

  it("prompts for a question when no argument is given", async () => {
    const pi = createPi();
    extension(pi as never);
    const ctx = createCtx();

    await pi.getCommand()?.handler("", ctx as never);

    expect(ctx.ui.input).toHaveBeenCalledWith(
      "Ask a side question",
      "Question",
    );
    expect(showMarkdownPager).toHaveBeenCalled();
  });

  it("adopts the process-wide prompt lock for the input dialog", async () => {
    const pi = createPi();
    extension(pi as never);
    const signal = new AbortController().signal;
    const ctx = createCtx({ signal });

    await pi.getCommand()?.handler("", ctx as never);

    expect(withPromptLock).toHaveBeenCalledTimes(1);
    expect(withPromptLock).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ signal }),
    );
    expect(ctx.ui.input).toHaveBeenCalledWith(
      "Ask a side question",
      "Question",
    );
  });

  it("reports a missing model without calling the registry", async () => {
    const pi = createPi();
    extension(pi as never);
    const ctx = createCtx({ model: undefined });

    await pi.getCommand()?.handler("why?", ctx as never);

    expect(ctx.modelRegistry.complete).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "pi-btw: no active model",
      "warning",
    );
  });

  it("returns silently on aborted stopReason", async () => {
    const pi = createPi();
    extension(pi as never);
    const ctx = createCtx();
    ctx.modelRegistry.complete.mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: "ignored" }],
      stopReason: "aborted",
    });
    await pi.getCommand()?.handler("why?", ctx as never);
    expect(showMarkdownPager).not.toHaveBeenCalled();
  });

  it("reports oversized question", async () => {
    const pi = createPi();
    extension(pi as never);
    const ctx = createCtx();
    await pi.getCommand()?.handler("x".repeat(5000), ctx as never);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("exceeds"),
      "warning",
    );
  });

  it("passes a dedicated cancellable signal to complete()", async () => {
    const pi = createPi();
    extension(pi as never);
    const ctx = createCtx();

    await pi.getCommand()?.handler("why?", ctx as never);

    const options = ctx.modelRegistry.complete.mock.calls[0][2] as {
      signal?: AbortSignal;
    };
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal?.aborted).toBe(false);

    const onInput = ctx.ui.onTerminalInput.mock.calls[0][0] as (
      data: string,
    ) => { consume?: boolean } | undefined;
    expect(onInput("\x1b")).toEqual({ consume: true });
    expect(options.signal?.aborted).toBe(true);
  });

  it("suppresses a thrown abort without an error toast", async () => {
    const pi = createPi();
    extension(pi as never);
    const ctx = createCtx();
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    ctx.modelRegistry.complete.mockRejectedValue(error);

    await pi.getCommand()?.handler("why?", ctx as never);

    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("sanitizes control bytes from model text in pager markdown", async () => {
    const pi = createPi();
    extension(pi as never);
    const ctx = createCtx();
    ctx.modelRegistry.complete.mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: "ok \x1b]0;pwn\x07" }],
      stopReason: "end",
    });

    await pi.getCommand()?.handler("why?", ctx as never);

    const markdown = showMarkdownPager.mock.calls[0][1].markdown as string;
    const hasControl = Array.from(markdown).some((char) => {
      const code = char.charCodeAt(0);
      return (
        (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
        code === 0x7f
      );
    });
    expect(hasControl).toBe(false);
  });

  it("sanitizes control bytes in error notifications", async () => {
    const pi = createPi();
    extension(pi as never);
    const ctx = createCtx();
    ctx.modelRegistry.complete.mockRejectedValue(new Error("bad \x1b[31m red"));

    await pi.getCommand()?.handler("why?", ctx as never);

    const message = ctx.ui.notify.mock.calls[0][0] as string;
    expect(message).not.toContain("\x1b");
    expect(message).toContain("bad");
  });

  it("builds context messages and extracts text", () => {
    expect(
      buildBtwMessages(
        [
          {
            role: "user",
            content: [{ type: "text", text: "Earlier" }],
            timestamp: 1,
          },
        ],
        "Question",
      ),
    ).toHaveLength(2);
    expect(
      responseText({
        content: [
          { type: "thinking", thinking: "ignore" },
          { type: "text", text: " answer " },
        ],
      } as never),
    ).toBe("answer");
  });
});
