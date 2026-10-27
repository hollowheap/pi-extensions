import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

type Handler = (event: unknown, ctx: unknown) => unknown;

const TOOL_REGISTRATION = "register" + "Tool";

function createMockPi() {
  const handlers: Record<string, Handler> = {};
  const eventHandlers: Record<string, (data: unknown) => void> = {};
  const pi = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers[event] = handler;
      return () => {};
    }),
    events: {
      on: vi.fn((event: string, handler: (data: unknown) => void) => {
        eventHandlers[event] = handler;
      }),
      emit: vi.fn((event: string, data: unknown) => {
        eventHandlers[event]?.(data);
      }),
    },
    registerMessageRenderer: vi.fn(),
    registerMarkdownTransformer: vi.fn(),
    registerCommand: vi.fn(),
    sendMessage: vi.fn(),
    appendEntry: vi.fn(),
    [TOOL_REGISTRATION]: vi.fn(),
  };
  return { pi, handlers, eventHandlers };
}

function assistant(...text: string[]) {
  return {
    role: "assistant",
    content: text.map((part) => ({ type: "text", text: part })),
  };
}

function context(overrides: Record<string, unknown> = {}) {
  const sessionManager = {
    getBranch: vi.fn(() => [] as unknown[]),
  };
  return {
    hasUI: true,
    mode: "tui",
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      custom: vi.fn(),
    },
    sessionManager,
    ...overrides,
  };
}

function emit(
  handler: Handler,
  message: unknown,
  ctx: ReturnType<typeof context>,
) {
  return handler({ type: "message_end", message }, ctx);
}

function customEntry(data: unknown) {
  return { type: "custom", customType: "hollowheap.todos", data };
}

interface ComponentLike {
  render: (width: number) => string[];
  handleInput?: (data: string) => void;
}

function customOnce() {
  let component: ComponentLike | undefined;
  const custom = vi.fn(
    (
      factory: (
        tui: unknown,
        theme: unknown,
        keybindings: unknown,
        done: () => void,
      ) => ComponentLike,
    ) =>
      new Promise<void>((resolve) => {
        component = factory({}, {}, {}, () => resolve());
      }),
  );
  return { custom, component: () => component };
}

function command(pi: ReturnType<typeof createMockPi>["pi"]) {
  return pi.registerCommand.mock.calls[0][1] as {
    handler: (args: string, ctx: ReturnType<typeof context>) => Promise<void>;
  };
}

type Transformer = (
  markdown: string,
  context: {
    messageType: "user" | "assistant" | "assistant-thinking";
    isStreaming: boolean;
    availableWidth: number;
  },
) => string;

function transformer(pi: ReturnType<typeof createMockPi>["pi"]): Transformer {
  return pi.registerMarkdownTransformer.mock.calls[0][0] as Transformer;
}

describe("pi-todos extension", () => {
  it("registers no model tool and wires state plus the confirmation renderer", () => {
    const { pi } = createMockPi();
    extension(pi as never);

    expect(pi[TOOL_REGISTRATION]).not.toHaveBeenCalled();
    expect(pi.on).toHaveBeenCalledWith("message_end", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("session_tree", expect.any(Function));
    expect(pi.registerMessageRenderer).toHaveBeenCalledWith(
      "hollowheap.todos.updated",
      expect.any(Function),
    );
    expect(pi.registerMarkdownTransformer).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });

  it("creates todos, persists one state entry, and sends one confirmation", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const ctx = context();

    await emit(
      handlers.message_end,
      assistant("'''create_todos\n1. Write tests\n2. Update docs\n'''"),
      ctx,
    );

    const todos = [
      { id: 1, text: "Write tests", done: false },
      { id: 2, text: "Update docs", done: false },
    ];
    expect(pi.appendEntry).toHaveBeenCalledTimes(1);
    expect(pi.appendEntry).toHaveBeenCalledWith("hollowheap.todos", {
      todos,
      nextId: 3,
    });
    expect(pi.sendMessage).toHaveBeenCalledWith(
      {
        customType: "hollowheap.todos.updated",
        content: "Todos:\n#1 [ ] Write tests\n#2 [ ] Update docs",
        display: true,
        details: { todos, unknownIds: [] },
      },
      { deliverAs: "followUp" },
    );
  });

  it("restores the latest branch state and continues the ID sequence", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const ctx = context();
    ctx.sessionManager.getBranch.mockReturnValue([
      customEntry({
        todos: [{ id: 1, text: "First", done: false }],
        nextId: 2,
      }),
      customEntry({
        todos: [
          { id: 1, text: "First", done: false },
          { id: 2, text: "Second", done: false },
        ],
        nextId: 3,
      }),
    ]);

    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    await emit(
      handlers.message_end,
      assistant("'''create_todos\n1. Third\n'''"),
      ctx,
    );

    expect(pi.appendEntry).toHaveBeenCalledWith("hollowheap.todos", {
      todos: [
        { id: 1, text: "First", done: false },
        { id: 2, text: "Second", done: false },
        { id: 3, text: "Third", done: false },
      ],
      nextId: 4,
    });
  });

  it("restores on session_tree", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const ctx = context();
    ctx.sessionManager.getBranch.mockReturnValue([
      customEntry({
        todos: [{ id: 5, text: "Existing", done: false }],
        nextId: 6,
      }),
    ]);

    handlers.session_tree(
      { type: "session_tree", newLeafId: "leaf", oldLeafId: null },
      ctx,
    );
    await emit(
      handlers.message_end,
      assistant("'''create_todos\n1. Next\n'''"),
      ctx,
    );

    expect(pi.appendEntry).toHaveBeenCalledWith("hollowheap.todos", {
      todos: [
        { id: 5, text: "Existing", done: false },
        { id: 6, text: "Next", done: false },
      ],
      nextId: 7,
    });
  });

  it("completes known IDs and reports unknown IDs", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const ctx = context();
    ctx.sessionManager.getBranch.mockReturnValue([
      customEntry({
        todos: [{ id: 1, text: "First", done: false }],
        nextId: 2,
      }),
    ]);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);

    await emit(
      handlers.message_end,
      assistant("'''complete_todos\n1. 1\n2. 9\n'''"),
      ctx,
    );

    const todos = [{ id: 1, text: "First", done: true }];
    expect(pi.appendEntry).toHaveBeenCalledWith("hollowheap.todos", {
      todos,
      nextId: 2,
    });
    expect(pi.sendMessage).toHaveBeenCalledWith(
      {
        customType: "hollowheap.todos.updated",
        content: "Todos:\n#1 [x] First\nUnknown IDs: 9",
        display: true,
        details: { todos, unknownIds: [9] },
      },
      { deliverAs: "followUp" },
    );
  });

  it("processes multiple blocks in source order and persists once", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const ctx = context();

    await emit(
      handlers.message_end,
      assistant(
        "'''create_todos\n1. First\n2. Second\n'''\n'''complete_todos\n1. 1\n'''",
      ),
      ctx,
    );

    const todos = [
      { id: 1, text: "First", done: true },
      { id: 2, text: "Second", done: false },
    ];
    expect(pi.appendEntry).toHaveBeenCalledTimes(1);
    expect(pi.appendEntry).toHaveBeenCalledWith("hollowheap.todos", {
      todos,
      nextId: 3,
    });
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
    expect(pi.sendMessage).toHaveBeenCalledWith(
      {
        customType: "hollowheap.todos.updated",
        content: "Todos:\n#1 [x] First\n#2 [ ] Second",
        display: true,
        details: { todos, unknownIds: [] },
      },
      { deliverAs: "followUp" },
    );
  });

  it("sends a report but does not persist when every completion is unknown", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const ctx = context();
    ctx.sessionManager.getBranch.mockReturnValue([
      customEntry({
        todos: [{ id: 1, text: "First", done: false }],
        nextId: 2,
      }),
    ]);
    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);

    await emit(
      handlers.message_end,
      assistant("'''complete_todos\n1. 9\n'''"),
      ctx,
    );

    expect(pi.appendEntry).not.toHaveBeenCalled();
    expect(pi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Todos:\n#1 [ ] First\nUnknown IDs: 9",
        details: {
          todos: [{ id: 1, text: "First", done: false }],
          unknownIds: [9],
        },
      }),
      { deliverAs: "followUp" },
    );
  });

  it("ignores non-assistant messages, unknown tags, invalid blocks, and open fences", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const ctx = context();

    await emit(
      handlers.message_end,
      {
        role: "user",
        content: [{ type: "text", text: "'''create_todos\n1. A\n'''" }],
      },
      ctx,
    );
    await emit(handlers.message_end, assistant("'''other\n1. A\n'''"), ctx);
    await emit(
      handlers.message_end,
      assistant("'''create_todos\n- A\n'''"),
      ctx,
    );
    await emit(
      handlers.message_end,
      assistant("'''create_todos\n1. [ ] A\n'''"),
      ctx,
    );
    await emit(
      handlers.message_end,
      assistant("'''complete_todos\n1. 0\n'''"),
      ctx,
    );
    await emit(handlers.message_end, assistant("'''create_todos\n1. A"), ctx);

    expect(pi.appendEntry).not.toHaveBeenCalled();
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("applies only valid blocks in a mixed message and ignores fenced tags", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const ctx = context();

    await emit(
      handlers.message_end,
      assistant(
        "```\n'''create_todos\n1. Code\n'''\n```\n'''create_todos\n1. [ ] Bad\n'''\n'''other\n1. Ignored\n'''\n'''create_todos\n1. Good\n'''",
      ),
      ctx,
    );

    expect(pi.appendEntry).toHaveBeenCalledTimes(1);
    expect(pi.appendEntry).toHaveBeenCalledWith("hollowheap.todos", {
      todos: [{ id: 1, text: "Good", done: false }],
      nextId: 2,
    });
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not crash or mutate on malformed live blocks", () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const ctx = context();

    for (const text of [
      "'''create_todos\n'''",
      "'''create_todos\n- First\n'''",
      "'''complete_todos\n1. 0\n'''",
      "'''complete_todos\n1. abc\n'''",
      "'''create_todos\n1. First",
      "no block here",
    ]) {
      expect(() =>
        handlers.message_end(
          { type: "message_end", message: assistant(text) },
          ctx,
        ),
      ).not.toThrow();
    }

    expect(pi.appendEntry).not.toHaveBeenCalled();
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("is inert without a UI", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const ctx = context({ hasUI: false });

    await emit(
      handlers.message_end,
      assistant("'''create_todos\n1. A\n'''"),
      ctx,
    );

    expect(pi.appendEntry).not.toHaveBeenCalled();
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("does not reapply the same message object", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const ctx = context();
    const message = assistant("'''create_todos\n1. First\n'''");

    await emit(handlers.message_end, message, ctx);
    await emit(handlers.message_end, message, ctx);

    expect(pi.appendEntry).toHaveBeenCalledTimes(1);
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed persisted state without crashing", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const ctx = context();
    ctx.sessionManager.getBranch.mockReturnValue([
      customEntry({ todos: [null], nextId: 1 }),
      customEntry({ todos: [], nextId: "bad" }),
    ]);

    expect(() =>
      handlers.session_start({ type: "session_start", reason: "startup" }, ctx),
    ).not.toThrow();

    await emit(
      handlers.message_end,
      assistant("'''create_todos\n1. First\n'''"),
      ctx,
    );

    expect(pi.appendEntry).toHaveBeenCalledWith("hollowheap.todos", {
      todos: [{ id: 1, text: "First", done: false }],
      nextId: 2,
    });
  });

  it("adds a stable todo format section only when a UI is available", () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const sections: Record<string, string> = { keep: "yes" };

    const result = handlers.before_agent_start(
      { systemPromptOptions: { sections } },
      context(),
    );

    expect(result).toBeUndefined();
    expect(sections.keep).toBe("yes");
    const format = sections.todos_format;
    expect(format).toContain("'''create_todos");
    expect(format).toContain("'''complete_todos");
    expect(format).toContain("ordered list");
    expect(format).toContain("numeric ID");
    expect(format).toContain("appends");
    expect(format).toContain("follow-up");
    expect(format).toContain("/todos");
    expect(format).toContain("Do not call a todo tool");

    for (const mode of ["print", "json"]) {
      const gated: Record<string, string> = {};
      handlers.before_agent_start(
        { systemPromptOptions: { sections: gated } },
        context({ hasUI: false, mode }),
      );
      expect(gated.todos_format).toBeUndefined();
    }
  });

  it("strips valid todo blocks from assistant TUI markdown only", () => {
    const { pi } = createMockPi();
    extension(pi as never);
    const transform = (
      markdown: string,
      messageType: "user" | "assistant" | "assistant-thinking" = "assistant",
      isStreaming = false,
    ) =>
      transformer(pi)(markdown, {
        messageType,
        isStreaming,
        availableWidth: 80,
      });

    const valid = "before\n'''create_todos\n1. First\n'''\nafter";
    expect(transform(valid)).toBe("before\nafter");
    expect(transform(valid, "user")).toBe(valid);
    expect(transform(valid, "assistant-thinking")).toBe(valid);

    expect(transform("before\n'''complete_todos\n1. 1\n'''\nafter")).toBe(
      "before\nafter",
    );

    const invalid = "before\n'''create_todos\n- First\n'''\nafter";
    expect(transform(invalid)).toBe(invalid);
    expect(transform("before\n'''complete_todos\n1. 0\n'''\nafter")).toBe(
      "before\n'''complete_todos\n1. 0\n'''\nafter",
    );

    const mixed =
      "'''create_todos\n1. Good\n'''\n'''create_todos\n1. [ ] Bad\n'''";
    expect(transform(mixed)).toBe("'''create_todos\n1. [ ] Bad\n'''");

    const unknown = "before\n'''other\n1. First\n'''\nafter";
    expect(transform(unknown)).toBe(unknown);

    const fenced = "```\n'''create_todos\n1. First\n'''\n```\nafter";
    expect(transform(fenced)).toBe(fenced);

    const open = "before\n'''create_todos\n1. First";
    expect(transform(open, "assistant", true)).toBe("before\n");
    expect(transform(open)).toBe(open);
  });

  it("updates the compact widget after restore and changes without setting statusline", async () => {
    const { pi, handlers, eventHandlers } = createMockPi();
    extension(pi as never);
    const ctx = context();

    handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
    expect(ctx.ui.setWidget).toHaveBeenLastCalledWith("todos", undefined);

    await emit(
      handlers.message_end,
      assistant("'''create_todos\n1. First\n2. Second\n'''"),
      ctx,
    );
    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
    expect(ctx.ui.setWidget).toHaveBeenLastCalledWith("todos", [
      "Todos (2 open)",
      "[ ] #1 First",
      "[ ] #2 Second",
    ]);

    await emit(
      handlers.message_end,
      assistant("'''complete_todos\n1. 1\n'''"),
      ctx,
    );
    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
    expect(ctx.ui.setWidget).toHaveBeenLastCalledWith("todos", [
      "Todos (1 open, 1 done)",
      "[x] #1 \x1b[9mFirst\x1b[29m",
      "[ ] #2 Second",
    ]);

    // Subagent state arrives and is rendered alongside todos
    eventHandlers["subagents:state"]?.([
      { id: "sub-1", agent: "worker", state: "running" },
    ]);
    expect(ctx.ui.setWidget).toHaveBeenLastCalledWith("todos", [
      "Todos (1 open, 1 done)",
      "[x] #1 \x1b[9mFirst\x1b[29m",
      "[ ] #2 Second",
      "Subagents (1 active)",
      "@sub-1 [running] (worker)",
    ]);

    await emit(
      handlers.message_end,
      assistant("'''complete_todos\n1. 2\n'''"),
      ctx,
    );
    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
    expect(ctx.ui.setWidget).toHaveBeenLastCalledWith("todos", [
      "Todos (2 done)",
      "[x] #1 \x1b[9mFirst\x1b[29m",
      "[x] #2 \x1b[9mSecond\x1b[29m",
      "Subagents (1 active)",
      "@sub-1 [running] (worker)",
    ]);

    // Subagents finished, todos still displayed as 2 done
    eventHandlers["subagents:state"]?.([]);
    expect(ctx.ui.setWidget).toHaveBeenLastCalledWith("todos", [
      "Todos (2 done)",
      "[x] #1 \x1b[9mFirst\x1b[29m",
      "[x] #2 \x1b[9mSecond\x1b[29m",
    ]);
  });

  it("shows a closeable TUI todo list", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const ctx = context();
    await emit(
      handlers.message_end,
      assistant("'''create_todos\n1. First\n'''"),
      ctx,
    );

    const { custom, component } = customOnce();
    ctx.ui.custom = custom as never;
    const pending = command(pi).handler("", ctx);
    const view = component();
    const rendered = view?.render(80).join("\n") ?? "";

    expect(custom).toHaveBeenCalledTimes(1);
    expect(rendered).toContain("Todos");
    expect(rendered).toContain("#1 [ ] First");
    expect(rendered).toContain("Esc, Enter, q, or Ctrl+C to close");
    expect(ctx.ui.notify).not.toHaveBeenCalled();

    view?.handleInput?.("\x03");
    await pending;

    const escapeRun = customOnce();
    ctx.ui.custom = escapeRun.custom as never;
    const escapePending = command(pi).handler("", ctx);
    escapeRun.component()?.handleInput?.("\x1b");
    await escapePending;
  });

  it("uses notify for RPC and opens no dialog in print/json", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const ctx = context();
    await emit(
      handlers.message_end,
      assistant("'''create_todos\n1. First\n'''"),
      ctx,
    );

    const rpc = context({ mode: "rpc" });
    await command(pi).handler("", rpc);
    expect(rpc.ui.custom).not.toHaveBeenCalled();
    expect(rpc.ui.notify).toHaveBeenCalledWith("#1 [ ] First", "info");

    const print = context({ hasUI: false, mode: "print" });
    await command(pi).handler("", print);
    expect(print.ui.custom).not.toHaveBeenCalled();
    expect(print.ui.notify).not.toHaveBeenCalled();
  });

  it("deduplicates unknown IDs across multiple blocks", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const ctx = context();

    await emit(
      handlers.message_end,
      assistant("'''complete_todos\n1. 9\n'''\n'''complete_todos\n1. 9\n'''"),
      ctx,
    );

    expect(pi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Todos:\nNo todos\nUnknown IDs: 9",
        details: { todos: [], unknownIds: [9] },
      }),
      { deliverAs: "followUp" },
    );
  });

  it("renders confirmation details and falls back to content", () => {
    const { pi } = createMockPi();
    extension(pi as never);
    const [, renderer] = pi.registerMessageRenderer.mock.calls[0] as [
      string,
      (
        message: unknown,
        options: unknown,
        theme: unknown,
      ) => { render: (width: number) => string[] },
    ];
    const options = { expanded: false, outputPad: 0 };

    const rendered = renderer(
      {
        content: "fallback",
        details: {
          todos: [{ id: 1, text: "First", done: false }],
          unknownIds: [],
        },
      },
      options,
      {},
    );
    const renderedText = rendered.render(80).join("\n");
    expect(renderedText).toContain("Todos:");
    expect(renderedText).toContain("#1 [ ] First");

    const fallback = renderer(
      { content: "fallback", details: undefined },
      options,
      {},
    );
    expect(fallback.render(80).join("\n").trimEnd()).toBe("fallback");

    for (const details of [
      { todos: [null] },
      { todos: [{ id: 1, text: "First" }] },
      { todos: [{ id: 1, text: "First", done: "no" }] },
      { todos: [{ id: 0, text: "First", done: false }] },
      { todos: "nope" },
    ]) {
      const malformed = renderer({ content: "fallback", details }, options, {});
      expect(malformed.render(80).join("\n").trimEnd()).toBe("fallback");
    }

    const filtered = renderer(
      {
        content: "fallback",
        details: {
          todos: [{ id: 1, text: "First", done: false }],
          unknownIds: ["9", 8],
        },
      },
      options,
      {},
    );
    expect(filtered.render(80).join("\n")).toContain("Unknown IDs: 8");
    expect(filtered.render(80).join("\n")).not.toContain("9");
  });
});
