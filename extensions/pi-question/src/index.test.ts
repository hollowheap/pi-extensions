import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

type Handler = (event: unknown, ctx: unknown) => Promise<void> | void;

const TOOL_REGISTRATION = "register" + "Tool";

function createMockPi() {
  const handlers: Record<string, Handler> = {};
  const pi = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers[event] = handler;
      return () => {};
    }),
    [TOOL_REGISTRATION]: vi.fn(),
    registerMarkdownTransformer: vi.fn(),
    registerMessageRenderer: vi.fn(),
    sendMessage: vi.fn(),
  };
  return { pi, handlers };
}

function assistant(...text: string[]) {
  return {
    role: "assistant",
    content: text.map((part) => ({ type: "text", text: part })),
  };
}

function context(
  select: ReturnType<typeof vi.fn> = vi.fn(),
  input: ReturnType<typeof vi.fn> = vi.fn(),
  overrides: Record<string, unknown> = {},
) {
  return {
    hasUI: true,
    mode: "tui",
    ui: { select, input, custom: vi.fn() },
    ...overrides,
  };
}

interface MultiResult {
  selected: string[];
  writeIn?: string;
  cancelled: boolean;
}

interface ComponentLike {
  handleInput?: (data: string) => void;
  render: (width: number) => string[];
}

function multiCustom() {
  let component: ComponentLike | undefined;
  const tui = { requestRender: vi.fn() };
  const custom = vi.fn(
    (
      factory: (
        tui: unknown,
        theme: unknown,
        keybindings: unknown,
        done: (result: MultiResult) => void,
      ) => ComponentLike,
    ) =>
      new Promise<MultiResult>((resolve) => {
        component = factory(tui, {}, {}, resolve);
      }),
  );
  return { custom, tui, component: () => component };
}

function emit(
  handler: Handler,
  message: unknown,
  ctx: ReturnType<typeof context>,
) {
  return handler({ type: "message_end", message }, ctx);
}

describe("pi-question extension", () => {
  it("registers no model tool and listens for assistant message_end", () => {
    const { pi } = createMockPi();
    extension(pi as never);
    expect(pi[TOOL_REGISTRATION]).not.toHaveBeenCalled();
    expect(pi.on).toHaveBeenCalledWith("message_end", expect.any(Function));
  });

  it("adds a stable question format section only when a UI is available", () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const sections: Record<string, string> = { keep: "yes" };

    const result = handlers.before_agent_start(
      { systemPromptOptions: { sections } },
      context(),
    );

    expect(result).toBeUndefined();
    expect(sections.keep).toBe("yes");
    expect(sections.question_format).toContain("'''question");
    expect(sections.question_format).toContain("## ");
    expect(sections.question_format).toContain("1. ");
    expect(sections.question_format).toContain("[ ]");
    expect(sections.question_format).toContain("Write-in answer");
    expect(sections.question_format).toContain("0-8 options");
    expect(sections.question_format).toContain("without calling a tool");
    expect(sections.question_format).toContain("follow-up user message");

    for (const mode of ["print", "json"]) {
      const gated: Record<string, string> = {};
      handlers.before_agent_start(
        { systemPromptOptions: { sections: gated } },
        context(vi.fn(), vi.fn(), { hasUI: false, mode }),
      );
      expect(gated.question_format).toBeUndefined();
    }
  });

  it("keeps print and json inert for question dialogs", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);

    for (const mode of ["print", "json"]) {
      const select = vi.fn();
      const input = vi.fn();
      const ctx = context(select, input, { hasUI: false, mode });
      await emit(
        handlers.message_end,
        assistant("'''question\n## Pick\n1. Alpha\n'''"),
        ctx,
      );
      expect(select).not.toHaveBeenCalled();
      expect(input).not.toHaveBeenCalled();
    }
  });

  it("uses select and input for a single-select question in RPC mode", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi.fn(async () => "Write-in answer");
    const input = vi.fn(async () => "custom");
    const ctx = context(select, input, { mode: "rpc" });

    await emit(
      handlers.message_end,
      assistant("'''question\n## Pick\n1. Alpha\n'''"),
      ctx,
    );

    expect(select).toHaveBeenCalledWith("Pick", ["Alpha", "Write-in answer"]);
    expect(input).toHaveBeenCalledWith("Pick", "Custom answer");
    expect(pi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "1. custom" }),
      { deliverAs: "followUp" },
    );
  });

  it("asks a single-select question with a final write-in row", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi.fn(async () => "Beta");
    const input = vi.fn();
    const ctx = context(select, input);

    await emit(
      handlers.message_end,
      assistant("'''question\n## Pick\n1. Alpha\n2. Beta\n'''"),
      ctx,
    );

    expect(select).toHaveBeenCalledWith("Pick", [
      "Alpha",
      "Beta",
      "Write-in answer",
    ]);
    expect(input).not.toHaveBeenCalled();
  });

  it("reads a write-in answer through input", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi.fn(async () => "Write-in answer");
    const input = vi.fn(async () => "custom");
    const ctx = context(select, input);

    await emit(
      handlers.message_end,
      assistant("'''question\n## Pick\n1. Alpha\n2. Beta\n'''"),
      ctx,
    );

    expect(input).toHaveBeenCalledWith("Pick", "Custom answer");
  });

  it("asks a free-text question through input", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi.fn();
    const input = vi.fn(async () => "because");
    const ctx = context(select, input);

    await emit(
      handlers.message_end,
      assistant("'''question\n## Why?\n'''"),
      ctx,
    );

    expect(input).toHaveBeenCalledWith("Why?");
    expect(select).not.toHaveBeenCalled();
  });

  it("asks multiple questions in source order", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const prompts: string[] = [];
    const select = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return prompt === "First" ? "Yes" : "No";
    });
    const ctx = context(select);

    await emit(
      handlers.message_end,
      assistant(
        "'''question\n## First\n1. Yes\n2. No\n## Second\n1. Yes\n2. No\n'''",
      ),
      ctx,
    );

    expect(prompts).toEqual(["First", "Second"]);
  });

  it("does nothing without a UI", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi.fn();
    const input = vi.fn();

    await emit(
      handlers.message_end,
      assistant("'''question\n## Pick\n1. Alpha\n'''"),
      context(select, input, { hasUI: false, mode: "print" }),
    );

    expect(select).not.toHaveBeenCalled();
    expect(input).not.toHaveBeenCalled();
  });

  it("ignores non-assistant messages and invalid blocks", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi.fn();
    const input = vi.fn();
    const ctx = context(select, input);

    await emit(
      handlers.message_end,
      { role: "user", content: [{ type: "text", text: "'''question" }] },
      ctx,
    );
    await emit(
      handlers.message_end,
      assistant("'''question\n- Alpha\n'''"),
      ctx,
    );
    await emit(
      handlers.message_end,
      assistant("'''other\n## Pick\n1. Alpha\n'''"),
      ctx,
    );
    await emit(
      handlers.message_end,
      assistant("'''question\n## Pick\n1. Alpha"),
      ctx,
    );
    const nine = Array.from(
      { length: 9 },
      (_, index) => `${index + 1}. Option ${index + 1}`,
    ).join("\n");
    await emit(
      handlers.message_end,
      assistant(`'''question\n## Pick\n${nine}\n'''`),
      ctx,
    );
    await emit(
      handlers.message_end,
      assistant("'''question\n## Pick\n1. Alpha\n2. Write-in answer\n'''"),
      ctx,
    );

    expect(select).not.toHaveBeenCalled();
    expect(input).not.toHaveBeenCalled();
  });

  it("asks only valid blocks when a message mixes valid and invalid blocks", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi.fn(async () => "Alpha");
    const ctx = context(select);

    await emit(
      handlers.message_end,
      assistant(
        "'''question\n## Good\n1. Alpha\n'''\n'''question\n## Bad\n1. [ ] Alpha\n2. Beta\n'''\n```\n'''question\n## Code\n1. Alpha\n'''\n```",
      ),
      ctx,
    );

    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith("Good", ["Alpha", "Write-in answer"]);
    expect(pi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "1. Alpha" }),
      { deliverAs: "followUp" },
    );
  });

  it("never throws on malformed blocks", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi.fn();
    const input = vi.fn();
    const ctx = context(select, input);

    for (const text of [
      "'''question\n'''",
      "'''question\n###\n'''",
      "'''question\n## \n'''",
      "'''question\n1. \n'''",
      "no block here",
    ]) {
      await expect(
        emit(handlers.message_end, assistant(text), ctx),
      ).resolves.toBeUndefined();
    }

    expect(select).not.toHaveBeenCalled();
    expect(input).not.toHaveBeenCalled();
  });

  it("cancels the whole set when the first dialog is dismissed", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi.fn(async () => undefined);
    const input = vi.fn();
    const ctx = context(select, input);

    await emit(
      handlers.message_end,
      assistant("'''question\n## First\n1. Yes\n## Second\n1. No\n'''"),
      ctx,
    );

    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith("First", ["Yes", "Write-in answer"]);
    expect(input).not.toHaveBeenCalled();
  });

  it("cancels the whole set when a write-in dialog is dismissed", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi.fn(async () => "Write-in answer");
    const input = vi.fn(async () => undefined);
    const ctx = context(select, input);

    await emit(
      handlers.message_end,
      assistant("'''question\n## First\n1. Yes\n## Second\n1. No\n'''"),
      ctx,
    );

    expect(select).toHaveBeenCalledTimes(1);
    expect(input).toHaveBeenCalledTimes(1);
  });

  it("renders TUI multi-select rows and toggles them with space", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const { custom, tui, component } = multiCustom();
    const select = vi.fn();
    const ctx = context(select);
    ctx.ui.custom = custom as never;

    const pending = emit(
      handlers.message_end,
      assistant("'''question\n## Pick\n1. [ ] Alpha\n2. [x] Beta\n'''"),
      ctx,
    );
    const view = component();
    expect(view).toBeDefined();
    expect(select).not.toHaveBeenCalled();
    expect(custom).toHaveBeenCalledTimes(1);

    const rendered = view?.render(80).join("\n") ?? "";
    expect(rendered).toContain("[ ] Alpha");
    expect(rendered).toContain("[ ] Beta");
    expect(rendered).toContain("Write-in answer");
    expect(rendered).toContain("Done");

    view?.handleInput?.(" ");
    expect(view?.render(80).join("\n") ?? "").toContain("[x] Alpha");
    view?.handleInput?.("\x1b[B");
    view?.handleInput?.(" ");
    view?.handleInput?.("\x1b[B");
    view?.handleInput?.("\x1b[B");
    view?.handleInput?.("\r");

    await pending;
    expect(tui.requestRender).toHaveBeenCalled();
    expect(pi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "1. Alpha, Beta" }),
      { deliverAs: "followUp" },
    );
  });

  it("submits zero TUI multi-select rows as none selected", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const { custom, component } = multiCustom();
    const ctx = context();
    ctx.ui.custom = custom as never;

    const pending = emit(
      handlers.message_end,
      assistant("'''question\n## Pick\n1. [ ] Alpha\n2. [ ] Beta\n'''"),
      ctx,
    );
    const view = component();
    view?.handleInput?.("\x1b[B");
    view?.handleInput?.("\x1b[B");
    view?.handleInput?.("\x1b[B");
    view?.handleInput?.("\r");

    await pending;
    const sent = pi.sendMessage.mock.calls[0][0] as {
      content: string;
      details: { answers: unknown[] };
    };
    expect(sent.content).toBe("1. none selected");
    expect(sent.details.answers[0]).toMatchObject({
      mode: "multi",
      selected: [],
    });
  });

  it("collects a TUI multi-select write-in through the inline editor", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const { custom, component } = multiCustom();
    const ctx = context();
    ctx.ui.custom = custom as never;

    const pending = emit(
      handlers.message_end,
      assistant("'''question\n## Pick\n1. [ ] Alpha\n2. [ ] Beta\n'''"),
      ctx,
    );
    const view = component();
    view?.handleInput?.(" ");
    view?.handleInput?.("\x1b[B");
    view?.handleInput?.("\x1b[B");
    view?.handleInput?.("\r");
    for (const char of "custom") view?.handleInput?.(char);
    expect(view?.render(80).join("\n") ?? "").toContain("custom");
    view?.handleInput?.("\r");
    view?.handleInput?.("\r");

    await pending;
    const sent = pi.sendMessage.mock.calls[0][0] as {
      content: string;
      details: { answers: unknown[] };
    };
    expect(sent.content).toBe("1. Alpha, Write-in: custom");
    expect(sent.details.answers[0]).toMatchObject({
      mode: "multi",
      selected: ["Alpha"],
      writeIn: "custom",
    });
  });

  it("cancels the TUI multi-select set on escape", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const { custom, component } = multiCustom();
    const ctx = context();
    ctx.ui.custom = custom as never;

    const pending = emit(
      handlers.message_end,
      assistant("'''question\n## Pick\n1. [ ] Alpha\n'''"),
      ctx,
    );
    component()?.handleInput?.("\x1b");

    await pending;
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("toggles RPC multi-select rows through select until Done", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi
      .fn()
      .mockResolvedValueOnce("[ ] Alpha")
      .mockResolvedValueOnce("[ ] Beta")
      .mockResolvedValueOnce("Done");
    const input = vi.fn();
    const ctx = context(select, input, { mode: "rpc" });

    await emit(
      handlers.message_end,
      assistant("'''question\n## Pick\n1. [ ] Alpha\n2. [ ] Beta\n'''"),
      ctx,
    );

    expect(ctx.ui.custom).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledTimes(3);
    expect(select.mock.calls[0][1]).toEqual([
      "[ ] Alpha",
      "[ ] Beta",
      "Write-in answer",
      "Done",
    ]);
    expect(select.mock.calls[1][1]).toEqual([
      "[x] Alpha",
      "[ ] Beta",
      "Write-in answer",
      "Done",
    ]);
    expect(select.mock.calls[2][1]).toEqual([
      "[x] Alpha",
      "[x] Beta",
      "Write-in answer",
      "Done",
    ]);
    expect(input).not.toHaveBeenCalled();
    expect(pi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "1. Alpha, Beta" }),
      { deliverAs: "followUp" },
    );
  });

  it("submits zero RPC multi-select rows as none selected", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi.fn().mockResolvedValueOnce("Done");
    const ctx = context(select, vi.fn(), { mode: "rpc" });

    await emit(
      handlers.message_end,
      assistant("'''question\n## Pick\n1. [ ] Alpha\n2. [ ] Beta\n'''"),
      ctx,
    );

    expect(pi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "1. none selected" }),
      { deliverAs: "followUp" },
    );
  });

  it("collects an RPC multi-select write-in through input", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi
      .fn()
      .mockResolvedValueOnce("Write-in answer")
      .mockResolvedValueOnce("Done");
    const input = vi.fn().mockResolvedValueOnce("custom");
    const ctx = context(select, input, { mode: "rpc" });

    await emit(
      handlers.message_end,
      assistant("'''question\n## Pick\n1. [ ] Alpha\n2. [ ] Beta\n'''"),
      ctx,
    );

    expect(input).toHaveBeenCalledWith("Pick", "Custom answer");
    expect(pi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "1. Write-in: custom" }),
      { deliverAs: "followUp" },
    );
  });

  it("cancels the RPC multi-select set when select is dismissed", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi.fn().mockResolvedValueOnce(undefined);
    const ctx = context(select, vi.fn(), { mode: "rpc" });

    await emit(
      handlers.message_end,
      assistant("'''question\n## Pick\n1. [ ] Alpha\n'''"),
      ctx,
    );

    expect(select).toHaveBeenCalledTimes(1);
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("cancels the RPC multi-select set when write-in is dismissed", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi.fn().mockResolvedValueOnce("Write-in answer");
    const input = vi.fn().mockResolvedValueOnce(undefined);
    const ctx = context(select, input, { mode: "rpc" });

    await emit(
      handlers.message_end,
      assistant("'''question\n## Pick\n1. [ ] Alpha\n'''"),
      ctx,
    );

    expect(select).toHaveBeenCalledTimes(1);
    expect(input).toHaveBeenCalledTimes(1);
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("falls back to the select loop when TUI custom is unavailable", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi.fn().mockResolvedValueOnce("Done");
    const ctx = context(select);
    ctx.ui.custom = undefined as never;

    await emit(
      handlers.message_end,
      assistant("'''question\n## Pick\n1. [ ] Alpha\n'''"),
      ctx,
    );

    expect(select).toHaveBeenCalledTimes(1);
    expect(pi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "1. none selected" }),
      { deliverAs: "followUp" },
    );
  });

  it("sends one numbered follow-up after all questions are answered", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi.fn(async (prompt: string) =>
      prompt === "First" ? "Yes" : "No",
    );
    const ctx = context(select);

    await emit(
      handlers.message_end,
      assistant(
        "'''question\n## First\n1. Yes\n2. No\n## Second\n1. Yes\n2. No\n'''",
      ),
      ctx,
    );

    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
    expect(pi.sendMessage).toHaveBeenCalledWith(
      {
        customType: "hollowheap.question.answers",
        content: "1. Yes\n2. No",
        display: true,
        details: {
          questions: [
            { prompt: "First", mode: "single", options: ["Yes", "No"] },
            { prompt: "Second", mode: "single", options: ["Yes", "No"] },
          ],
          answers: [
            { mode: "single", value: "Yes" },
            { mode: "single", value: "No" },
          ],
        },
      },
      { deliverAs: "followUp" },
    );
  });

  it("sends write-in and free-text answers with the 500-character cap", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi.fn(async () => "Write-in answer");
    const input = vi
      .fn()
      .mockResolvedValueOnce("custom")
      .mockResolvedValueOnce("x".repeat(600));
    const ctx = context(select, input);

    await emit(
      handlers.message_end,
      assistant("'''question\n## Pick\n1. Alpha\n## Why?\n'''"),
      ctx,
    );

    expect(pi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: `1. custom\n2. ${"x".repeat(500)}`,
      }),
      { deliverAs: "followUp" },
    );
  });

  it("sends nothing when a dialog is cancelled", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi.fn(async () => undefined);
    const ctx = context(select);

    await emit(
      handlers.message_end,
      assistant("'''question\n## Pick\n1. Alpha\n'''"),
      ctx,
    );

    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("renders numbered details and falls back to content", () => {
    const { pi } = createMockPi();
    extension(pi as never);
    const [type, renderer] = pi.registerMessageRenderer.mock.calls[0] as [
      string,
      (
        message: unknown,
        options: unknown,
        theme: unknown,
      ) => {
        render: (width: number) => string[];
      },
    ];
    expect(type).toBe("hollowheap.question.answers");

    const options = { expanded: false, outputPad: 0 };
    const rendered = renderer(
      {
        content: "1. fallback",
        details: { answers: [{ mode: "single", value: "Beta" }] },
      },
      options,
      {},
    );
    expect(rendered.render(80).join("\n").trimEnd()).toBe("1. Beta");

    const fallback = renderer(
      { content: "1. fallback", details: undefined },
      options,
      {},
    );
    expect(fallback.render(80).join("\n").trimEnd()).toBe("1. fallback");

    expect(() =>
      renderer(
        { content: "1. fallback", details: { answers: [null] } },
        options,
        {},
      ),
    ).not.toThrow();
  });

  it("strips closed valid question blocks from assistant markdown", () => {
    const { pi } = createMockPi();
    extension(pi as never);
    const transformer = pi.registerMarkdownTransformer.mock.calls[0][0] as (
      markdown: string,
      context: {
        messageType: "user" | "assistant" | "assistant-thinking";
        isStreaming: boolean;
        availableWidth: number;
      },
    ) => string;
    const transform = (
      markdown: string,
      messageType: "user" | "assistant" | "assistant-thinking" = "assistant",
      isStreaming = false,
    ) =>
      transformer(markdown, { messageType, isStreaming, availableWidth: 80 });

    const valid = "before\n'''question\n## Pick\n1. Alpha\n'''\nafter";
    expect(transform(valid)).toBe("before\nafter");
    expect(transform(valid, "user")).toBe(valid);
    expect(transform(valid, "assistant-thinking")).toBe(valid);

    const invalid = "before\n'''question\n- Alpha\n'''\nafter";
    expect(transform(invalid)).toBe(invalid);

    const mixed =
      "'''question\n## Good\n1. Alpha\n'''\n'''question\n## Bad\n1. [ ] Alpha\n2. Beta\n'''";
    expect(transform(mixed)).toBe(
      "'''question\n## Bad\n1. [ ] Alpha\n2. Beta\n'''",
    );

    const unknown = "before\n'''other\n## Pick\n1. Alpha\n'''\nafter";
    expect(transform(unknown)).toBe(unknown);

    const fenced = "```\n'''question\n## Pick\n1. Alpha\n'''\n```\nafter";
    expect(transform(fenced)).toBe(fenced);

    const open = "before\n'''question\n## Pick\n1. Alpha";
    expect(transform(open, "assistant", true)).toBe("before\n");
    expect(transform(open)).toBe(open);
  });

  it("does not re-ask an already handled message", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const select = vi.fn(async () => "Yes");
    const ctx = context(select);
    const message = assistant("'''question\n## Pick\n1. Yes\n'''");

    await emit(handlers.message_end, message, ctx);
    await emit(handlers.message_end, message, ctx);

    expect(select).toHaveBeenCalledTimes(1);
  });
});
