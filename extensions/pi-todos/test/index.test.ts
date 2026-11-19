import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { getSessionSnapshot } from "@hollowheap/core/snapshot";
import { describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";

function isPromptLockHeld(): boolean {
  const lock = (
    globalThis as Record<symbol, { state?: { locked?: boolean } } | undefined>
  )[Symbol.for("@hollowheap/core/prompt-lock")];
  return lock?.state?.locked === true;
}

type Handler = (event: unknown, ctx: unknown) => unknown;

function firstText(result: { content: unknown[] }): string {
  const item = result.content[0] as { text?: string } | undefined;
  return item?.text ?? "";
}

function createMockPi() {
  const handlers: Record<string, Handler> = {};
  const eventHandlers: Record<string, (data: unknown) => void> = {};
  const activeTools = ["read", "bash"];
  const allTools = [{ name: "read" }, { name: "bash" }, { name: "codemode" }];
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
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    appendEntry: vi.fn(),
    registerTool: vi.fn(),
    getActiveTools: vi.fn(() => [...activeTools]),
    getAllTools: vi.fn(() => [...allTools]),
    setActiveTools: vi.fn((tools: string[]) => {
      activeTools.length = 0;
      activeTools.push(...tools);
    }),
  };
  return { pi, handlers, eventHandlers };
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
      onTerminalInput: vi.fn(
        (_handler: (data: string) => { consume?: boolean } | undefined) =>
          vi.fn(),
      ),
    },
    sessionManager,
    ...overrides,
  };
}

function customEntry(data: unknown) {
  return { type: "custom", customType: "hollowheap.todos", data };
}

describe("pi-todos extension", () => {
  it("registers todo tool with codemode exposure and lifecycle hooks", () => {
    const { pi } = createMockPi();
    extension(pi as never);

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const tool = pi.registerTool.mock.calls[0][0];
    expect(tool.name).toBe("todo");
    expect(tool.exposure).toBe("codemode");
    expect(tool.promptGuidelines).toBeDefined();
    expect(tool.promptGuidelines?.[0]).toContain("tools.todo via codemode");

    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("session_tree", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("session_compact", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith(
      "session_shutdown",
      expect.any(Function),
    );
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "todos",
      expect.any(Object),
    );
    expect(pi.registerCommand).not.toHaveBeenCalledWith(
      "todo",
      expect.any(Object),
    );
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "widget",
      expect.any(Object),
    );
  });

  it("activates codemode on session_start and removes direct todo exposure", () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const ctx = context();

    handlers.session_start({}, ctx);
    expect(pi.setActiveTools).toHaveBeenCalledWith([
      "read",
      "bash",
      "codemode",
    ]);
  });

  it("restores branch state on session_start and continues sequential ID", () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);

    const ctx = context({
      sessionManager: {
        getBranch: () => [
          customEntry({
            todos: [
              { id: 1, text: "Existing task", done: true },
              { id: 2, text: "Open task", done: false },
            ],
            nextId: 3,
          }),
        ],
      },
    });

    handlers.session_start({}, ctx);
    expect(ctx.ui.setWidget).toHaveBeenCalledWith(
      "todos",
      expect.any(Function),
    );
  });

  it("creates todos, appends entry, and updates widget via todo tool", async () => {
    const { pi } = createMockPi();
    extension(pi as never);
    const tool = pi.registerTool.mock.calls[0][0];
    const ctx = context();

    const result = await tool.execute(
      "call-1",
      { action: "create", tasks: ["First task", "Second task"] },
      undefined,
      undefined,
      ctx,
    );

    expect(firstText(result)).toContain("1 First task");
    expect(firstText(result)).toContain("2 Second task");
    expect(pi.appendEntry).toHaveBeenCalledWith("hollowheap.todos", {
      todos: [
        { id: 1, text: "First task", done: false },
        { id: 2, text: "Second task", done: false },
      ],
      nextId: 3,
      updatedAt: expect.any(Number),
    });
    expect(ctx.ui.setWidget).toHaveBeenCalledWith(
      "todos",
      expect.any(Function),
    );
  });

  it("lists todos via todo tool", async () => {
    const { pi } = createMockPi();
    extension(pi as never);
    const tool = pi.registerTool.mock.calls[0][0];
    const ctx = context();

    await tool.execute(
      "call-1",
      { action: "create", tasks: ["Task to list"] },
      undefined,
      undefined,
      ctx,
    );

    const listResult = await tool.execute(
      "call-2",
      { action: "list" },
      undefined,
      undefined,
      ctx,
    );

    expect(firstText(listResult)).toContain("1 Task to list");
    expect(listResult.details).toMatchObject({
      todos: [{ id: 1, text: "Task to list", done: false }],
    });
  });

  it("completes known IDs and reports unknown IDs via todo tool", async () => {
    const { pi } = createMockPi();
    extension(pi as never);
    const tool = pi.registerTool.mock.calls[0][0];
    const ctx = context();

    await tool.execute(
      "call-1",
      { action: "create", tasks: ["Task 1", "Task 2"] },
      undefined,
      undefined,
      ctx,
    );

    const compResult = await tool.execute(
      "call-2",
      { action: "complete", ids: [1, 99] },
      undefined,
      undefined,
      ctx,
    );

    expect(firstText(compResult)).toContain("✓ 1 Task 1");
    expect(firstText(compResult)).toContain("Unknown IDs: 99");
    expect(compResult.details).toMatchObject({
      unknownIds: [99],
    });
  });

  it("deletes completed todos via todo tool", async () => {
    const { pi } = createMockPi();
    extension(pi as never);
    const tool = pi.registerTool.mock.calls[0][0];
    const ctx = context();

    await tool.execute(
      "call-1",
      { action: "create", tasks: ["Task 1", "Task 2"] },
      undefined,
      undefined,
      ctx,
    );
    await tool.execute(
      "call-2",
      { action: "complete", id: 1 },
      undefined,
      undefined,
      ctx,
    );

    const delResult = await tool.execute(
      "call-3",
      { action: "delete", id: 1 },
      undefined,
      undefined,
      ctx,
    );

    expect(delResult.details).toMatchObject({
      todos: [{ id: 2, text: "Task 2", done: false }],
    });
  });

  it("edits task text and changes priority via todo tool", async () => {
    const { pi } = createMockPi();
    extension(pi as never);
    const tool = pi.registerTool.mock.calls[0][0];
    const ctx = context();

    await tool.execute(
      "call-1",
      { action: "create", text: "Old text" },
      undefined,
      undefined,
      ctx,
    );

    await tool.execute(
      "call-2",
      { action: "edit", id: 1, text: "New text" },
      undefined,
      undefined,
      ctx,
    );

    await tool.execute(
      "call-3",
      { action: "priority", id: 1, priority: "high" },
      undefined,
      undefined,
      ctx,
    );

    const listResult = await tool.execute(
      "call-4",
      { action: "list" },
      undefined,
      undefined,
      ctx,
    );
    expect(listResult.details).toMatchObject({
      todos: [{ id: 1, text: "New text", priority: "high" }],
    });
  });

  it("persists state after session compaction", () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const tool = pi.registerTool.mock.calls[0][0];
    const ctx = context();

    tool.execute(
      "call-1",
      { action: "create", text: "Compact me" },
      undefined,
      undefined,
      ctx,
    );
    pi.appendEntry.mockClear();

    handlers.session_compact({}, ctx);
    expect(pi.appendEntry).toHaveBeenCalledWith(
      "hollowheap.todos",
      expect.any(Object),
    );
  });

  it("completes and edits todos via /todos", async () => {
    const { pi } = createMockPi();
    extension(pi as never);
    const tool = pi.registerTool.mock.calls[0][0];
    const ctx = context();

    await tool.execute(
      "call-1",
      { action: "create", tasks: ["Task A", "Task B"] },
      undefined,
      undefined,
      ctx,
    );

    const todoCmd = pi.registerCommand.mock.calls.find(
      ([command]) => command === "todos",
    )?.[1];
    expect(todoCmd).toBeDefined();

    await todoCmd.handler("complete 1", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("✓ 1 Task A"),
      "info",
    );

    await todoCmd.handler("edit 2 Updated B", ctx);
    const listResult = await tool.execute(
      "call-2",
      { action: "list" },
      undefined,
      undefined,
      ctx,
    );
    expect(listResult.details).toMatchObject({
      todos: [
        { id: 1, done: true },
        { id: 2, text: "Updated B", done: false },
      ],
    });
  });

  it("searches todo text via /todos", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const ctx = context({ mode: "rpc" });
    ctx.sessionManager.getBranch.mockReturnValue([
      customEntry({
        todos: [
          { id: 1, text: "Review release notes", done: false },
          { id: 2, text: "Review invoices", done: true },
        ],
        nextId: 3,
      }),
    ]);
    handlers.session_start({}, ctx);
    const command = pi.registerCommand.mock.calls.find(
      ([command]) => command === "todos",
    )?.[1];

    await command.handler("  SeArCh   RELEASE notes  ", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledExactlyOnceWith(
      "• 1 Review release notes",
      "info",
    );
    expect(ctx.ui.custom).not.toHaveBeenCalled();
    expect(pi.appendEntry).not.toHaveBeenCalled();
  });

  it("publishes todos:state, statusline:values, and updateSessionSnapshot on mutation and answers statusline:request", async () => {
    const { pi, eventHandlers } = createMockPi();
    extension(pi as never);
    const tool = pi.registerTool.mock.calls[0][0];
    const ctx = context();

    // Create a todo with high priority
    await tool.execute(
      "call-1",
      { action: "create", tasks: ["Task 1", "Task 2"] },
      undefined,
      undefined,
      ctx,
    );

    expect(pi.events.emit).toHaveBeenCalledWith("todos:state", {
      todos: expect.any(Array),
      open: 2,
      total: 2,
    });
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "todos",
      text: "2 todos",
    });

    let snap = getSessionSnapshot(ctx.sessionManager).todos;
    expect(snap).toBeDefined();
    expect(snap?.total).toBe(2);
    expect(snap?.open).toBe(2);
    expect(snap?.done).toBe(0);
    expect(snap?.highPriority).toBe(0);
    expect(snap?.items).toHaveLength(2);

    // Set priority on Task 1
    await tool.execute(
      "call-2",
      { action: "priority", id: 1, priority: "high" },
      undefined,
      undefined,
      ctx,
    );
    snap = getSessionSnapshot(ctx.sessionManager).todos;
    expect(snap?.highPriority).toBe(1);

    // Answer statusline:request
    pi.events.emit.mockClear();
    eventHandlers["statusline:request"]?.({ names: ["todos"] });
    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "todos",
      text: "2 todos",
    });

    // Complete Task 1
    const todoCmd = pi.registerCommand.mock.calls.find(
      ([name]) => name === "todos",
    )?.[1];
    await todoCmd.handler("complete 1", ctx);

    expect(pi.events.emit).toHaveBeenCalledWith("statusline:values", {
      name: "todos",
      text: "1 todo",
    });
    snap = getSessionSnapshot(ctx.sessionManager).todos;
    expect(snap?.open).toBe(1);
    expect(snap?.done).toBe(1);
    expect(snap?.highPriority).toBe(0);
  });

  it("guides the model to the codemode todo tool instead of tagged blocks", () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const event = {
      systemPromptOptions: { sections: {} as Record<string, string> },
    };

    handlers.before_agent_start(event, context());

    const section = event.systemPromptOptions.sections.todos_format;
    expect(section).toContain("tools.todo");
    expect(section).not.toContain("create_todos");
    expect(section).not.toContain("complete_todos");
  });

  it("reports unknown IDs for edit and priority tool actions", async () => {
    const { pi } = createMockPi();
    extension(pi as never);
    const tool = pi.registerTool.mock.calls[0][0];
    const ctx = context();

    await tool.execute(
      "c1",
      { action: "create", tasks: ["Task 1"] },
      undefined,
      undefined,
      ctx,
    );

    const edited = await tool.execute(
      "c2",
      { action: "edit", id: 999, text: "x" },
      undefined,
      undefined,
      ctx,
    );
    expect(firstText(edited)).toContain("Unknown IDs: 999");
    expect(edited.details).toMatchObject({ unknownIds: [999] });

    const prioritized = await tool.execute(
      "c3",
      { action: "priority", id: 999, priority: "high" },
      undefined,
      undefined,
      ctx,
    );
    expect(firstText(prioritized)).toContain("Unknown IDs: 999");
    expect(prioritized.details).toMatchObject({ unknownIds: [999] });
  });

  it("does not persist or publish no-op todo mutations", async () => {
    const { pi } = createMockPi();
    extension(pi as never);
    const tool = pi.registerTool.mock.calls[0][0];
    const ctx = context();

    await tool.execute(
      "c1",
      { action: "complete", id: 999 },
      undefined,
      undefined,
      ctx,
    );
    expect(pi.appendEntry).not.toHaveBeenCalled();
    expect(pi.events.emit).not.toHaveBeenCalledWith(
      "todos:state",
      expect.anything(),
    );

    await tool.execute(
      "c2",
      { action: "create", text: "Open" },
      undefined,
      undefined,
      ctx,
    );
    pi.appendEntry.mockClear();
    await tool.execute(
      "c3",
      { action: "delete", id: 999 },
      undefined,
      undefined,
      ctx,
    );
    await tool.execute(
      "c4",
      { action: "edit", id: 999, text: "x" },
      undefined,
      undefined,
      ctx,
    );
    await tool.execute(
      "c5",
      { action: "priority", id: 999, priority: "low" },
      undefined,
      undefined,
      ctx,
    );
    expect(pi.appendEntry).not.toHaveBeenCalled();
  });

  it("ignores the panel chord while a prompt owns input and resets it on dialog open", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi as never);
    const ctx = context();
    handlers.session_start({}, ctx);
    const onInput = ctx.ui.onTerminalInput.mock.calls[0][0];
    const prefix = pi.registerShortcut.mock.calls.find(
      ([key]) => key === "alt+w",
    )?.[1];
    expect(prefix?.description).toContain("Then P to toggle sticky widgets");

    await withPromptLock(async () => {
      prefix.handler(ctx);
      expect(onInput("p")).not.toMatchObject({ consume: true });
    });
    expect(onInput("p")).not.toMatchObject({ consume: true });
    expect(onInput("\x18")).not.toMatchObject({ consume: true });
    expect(onInput("p")).not.toMatchObject({ consume: true });

    prefix.handler(ctx);
    const todosCmd = pi.registerCommand.mock.calls.find(
      ([name]) => name === "todos",
    )?.[1] as { handler: (args: string, ctx: unknown) => Promise<void> };
    await todosCmd.handler("", ctx);
    expect(onInput("p")).not.toMatchObject({ consume: true });
  });

  it("opens the /todos overlay under the prompt lock", async () => {
    const { pi } = createMockPi();
    extension(pi as never);
    const ctx = context();
    let lockHeldDuringCustom: boolean | undefined;
    ctx.ui.custom = vi.fn(async () => {
      lockHeldDuringCustom = isPromptLockHeld();
    });
    const todosCmd = pi.registerCommand.mock.calls.find(
      ([command]) => command === "todos",
    )?.[1] as { handler: (args: string, ctx: unknown) => Promise<void> };

    await todosCmd.handler("", ctx);
    expect(ctx.ui.custom).toHaveBeenCalledTimes(1);
    expect(lockHeldDuringCustom).toBe(true);
  });

  it("settles and releases the prompt lock when the /todos overlay is disposed", async () => {
    const { pi } = createMockPi();
    extension(pi as never);
    const ctx = context();
    let component: { dispose?(): void } | undefined;
    ctx.ui.custom = vi.fn(
      (
        factory: (
          tui: unknown,
          theme: unknown,
          keybindings: unknown,
          done: () => void,
        ) => { dispose?(): void },
      ) =>
        new Promise<void>((resolve) => {
          component = factory({ requestRender: vi.fn() }, {}, {}, resolve);
        }),
    );
    const todosCmd = pi.registerCommand.mock.calls.find(
      ([name]) => name === "todos",
    )?.[1] as { handler: (args: string, ctx: unknown) => Promise<void> };

    const pending = todosCmd.handler("", ctx);
    await vi.waitFor(() => expect(component).toBeDefined());
    expect(component?.dispose).toBeTypeOf("function");
    component?.dispose?.();
    await expect(pending).resolves.toBeUndefined();
    await expect(withPromptLock(async () => "next")).resolves.toBe("next");
  });

  it("validates the /widget toggle target", async () => {
    const { pi } = createMockPi();
    extension(pi as never);
    const ctx = context();
    const widgetCmd = pi.registerCommand.mock.calls.find(
      ([name]) => name === "widget",
    )?.[1] as {
      handler: (args: string, ctx: unknown) => Promise<void>;
      getArgumentCompletions: (prefix: string) => Array<{ value: string }>;
    };

    expect(
      widgetCmd.getArgumentCompletions("toggle ").map((c) => c.value),
    ).toContain("toggle subagents");

    await widgetCmd.handler("toggle bogus", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("bogus"),
      "error",
    );
    expect(ctx.ui.notify).not.toHaveBeenCalledWith("Widget collapsed", "info");

    ctx.ui.notify.mockClear();
    await widgetCmd.handler("toggle todos", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Todos widget collapsed",
      "info",
    );
  });
});
