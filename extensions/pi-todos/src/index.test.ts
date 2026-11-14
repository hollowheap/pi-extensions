import { getSessionSnapshot } from "@hollowheap/core/snapshot";
import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";

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
      onTerminalInput: vi.fn(() => vi.fn()),
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
    expect(pi.registerCommand).toHaveBeenCalledWith("todo", expect.any(Object));
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "panel",
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

  it("executes /todo complete and /todo edit slash commands", async () => {
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
      ([name]) => name === "todo",
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
      ([name]) => name === "todo",
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
});
