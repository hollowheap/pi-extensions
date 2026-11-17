import { beforeEach, describe, expect, it, vi } from "vitest";
import extension, { buildBtwMessages, responseText } from "./index.js";

const showMarkdownPager = vi.fn().mockResolvedValue(undefined);

vi.mock("@hollowheap/tui/pager", () => ({
  showMarkdownPager: (...args: unknown[]) => showMarkdownPager(...args),
}));

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
    },
    ...overrides,
  };
}

beforeEach(() => {
  showMarkdownPager.mockClear();
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
