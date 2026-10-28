import { describe, expect, it } from "vitest";
import {
  type TodoState,
  applyTodoCommand,
  emptyTodoState,
  formatTodoConfirmation,
  formatTodoList,
  formatTodoWidget,
  parseTodoBlock,
  statusText,
} from "./todos.js";

describe("parseTodoBlock", () => {
  it("parses create_todos as an ordered list of task texts", () => {
    expect(
      parseTodoBlock("create_todos", "1. Write tests\n2. Update docs"),
    ).toEqual({
      type: "create",
      texts: ["Write tests", "Update docs"],
    });
  });

  it("parses complete_todos as an ordered list of positive IDs", () => {
    expect(parseTodoBlock("complete_todos", "1. 1\n2. 3")).toEqual({
      type: "complete",
      ids: [1, 3],
    });
  });

  it("rejects unknown tags, other nodes, unordered lists, checkboxes, and empty lists", () => {
    expect(parseTodoBlock("other", "1. A")).toBeUndefined();
    expect(parseTodoBlock("create_todos", "")).toBeUndefined();
    expect(parseTodoBlock("create_todos", "## Heading\n1. A")).toBeUndefined();
    expect(parseTodoBlock("create_todos", "- A")).toBeUndefined();
    expect(parseTodoBlock("create_todos", "1. [ ] A")).toBeUndefined();
    expect(parseTodoBlock("create_todos", "1. A\n\n2. B")).toBeUndefined();
    expect(parseTodoBlock("create_todos", "1. ")).toBeUndefined();
  });

  it("rejects malformed complete IDs", () => {
    for (const body of [
      "1. 0",
      "1. 01",
      "1. -1",
      "1. abc",
      "1. 1.5",
      "1. 9007199254740992",
      "1. [ ] 1",
      "- 1",
    ]) {
      expect(parseTodoBlock("complete_todos", body)).toBeUndefined();
    }
  });
});

describe("applyTodoCommand", () => {
  it("appends create tasks with monotonic IDs", () => {
    const initial: TodoState = {
      todos: [{ id: 1, text: "Existing", done: false }],
      nextId: 2,
    };
    const result = applyTodoCommand(initial, {
      type: "create",
      texts: ["First", "Second"],
    });

    expect(result.changed).toBe(true);
    expect(result.unknownIds).toEqual([]);
    expect(result.state).toEqual({
      todos: [
        { id: 1, text: "Existing", done: false },
        { id: 2, text: "First", done: false },
        { id: 3, text: "Second", done: false },
      ],
      nextId: 4,
    });
    expect(initial.todos).toHaveLength(1);
  });

  it("completes known IDs once and reports unknown IDs", () => {
    const initial: TodoState = {
      todos: [
        { id: 1, text: "First", done: false },
        { id: 2, text: "Second", done: false },
      ],
      nextId: 3,
    };
    const result = applyTodoCommand(initial, {
      type: "complete",
      ids: [1, 1, 9, 9],
    });

    expect(result.changed).toBe(true);
    expect(result.unknownIds).toEqual([9]);
    expect(result.state.todos).toEqual([
      { id: 1, text: "First", done: true },
      { id: 2, text: "Second", done: false },
    ]);
    expect(initial.todos[0].done).toBe(false);
  });

  it("reports no change when every completion is already done or unknown", () => {
    const initial: TodoState = {
      todos: [{ id: 1, text: "First", done: true }],
      nextId: 2,
    };
    const result = applyTodoCommand(initial, {
      type: "complete",
      ids: [1, 9],
    });

    expect(result.changed).toBe(false);
    expect(result.unknownIds).toEqual([9]);
    expect(result.state).toEqual(initial);
  });
});

describe("todo formatting", () => {
  const todos = [
    { id: 2, text: "Second", done: true },
    { id: 1, text: "First", done: false },
  ];

  it("lists todos in ID order with done markers", () => {
    expect(formatTodoList(todos)).toBe("• 1 First\n✓ 2 Second");
    expect(formatTodoList([])).toBe("No todos");
  });

  it("reports open/total status and clears when empty", () => {
    expect(statusText([])).toBeUndefined();
    expect(statusText(todos)).toBe("1/2");
    expect(statusText([{ id: 1, text: "Done", done: true }])).toBe("0/1");
  });

  it("formats one confirmation with the full list and unknown IDs", () => {
    expect(formatTodoConfirmation(todos, [9, 9])).toBe(
      "Todos:\n• 1 First\n✓ 2 Second\nUnknown IDs: 9",
    );
    expect(formatTodoConfirmation(todos, [])).toBe(
      "Todos:\n• 1 First\n✓ 2 Second",
    );
    expect(formatTodoConfirmation([], [9])).toBe(
      "Todos:\nNo todos\nUnknown IDs: 9",
    );
  });

  it("formats a compact widget of todos with status checkboxes and strikethrough", () => {
    expect(formatTodoWidget([])).toBeUndefined();
    expect(formatTodoWidget([{ id: 1, text: "Done", done: true }])).toEqual([
      "╭─ Todos (1 ✓) ╮",
      "│ ✓ 1 \x1b[9mDone\x1b[29m     │",
      "╰──────────────╯",
    ]);
    expect(
      formatTodoWidget([{ id: 1, text: "Done", done: true }], [], {
        strikethrough: (s) => `~~${s}~~`,
      }),
    ).toEqual(["╭─ Todos (1 ✓) ╮", "│ ✓ 1 ~~Done~~ │", "╰──────────────╯"]);
    expect(formatTodoWidget(todos)).toEqual([
      "╭─ Todos (1 open, 1 ✓) ╮",
      "│ • 1 First            │",
      "│ ✓ 2 \x1b[9mSecond\x1b[29m           │",
      "╰──────────────────────╯",
    ]);

    const open = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      text: `Task ${index + 1}`,
      done: false,
    }));
    expect(formatTodoWidget(open)).toEqual([
      "╭─ Todos (12 open) ╮",
      "│ • 1 Task 1       │",
      "│ • 2 Task 2       │",
      "│ • 3 Task 3       │",
      "│ • 4 Task 4       │",
      "│ • 5 Task 5       │",
      "│ • 6 Task 6       │",
      "│ • 7 Task 7       │",
      "│ • 8 Task 8       │",
      "│ • 9 Task 9       │",
      "│ • 10 Task 10     │",
      "│ +2 more (/todos) │",
      "╰──────────────────╯",
    ]);
    expect(formatTodoWidget([], [{ id: "sub-1", state: "running" }])).toEqual([
      "╭─ Subagents (1 active) ╮",
      "│ @sub-1 ●              │",
      "╰───────────────────────╯",
    ]);
    const testNow = 1_000_000;
    expect(
      formatTodoWidget(
        [],
        [
          {
            id: "scout-1",
            agent: "scout",
            task: "Analyze auth",
            state: "running",
            startedAt: testNow - 84_000,
            activeTool: "edit",
            activeToolStartedAt: testNow - 10_000,
          },
        ],
        undefined,
        { now: testNow },
      ),
    ).toEqual([
      "╭─ Subagents (1 active) ─────────────────────╮",
      "│ @scout-1 01:24 (Analyze auth) ● · edit 10s │",
      "╰────────────────────────────────────────────╯",
    ]);
    expect(
      formatTodoWidget(
        [],
        [
          {
            id: "scout-2",
            state: "running",
            task: "Analyze\nauth\nflow",
            startedAt: testNow - 10_000,
          },
        ],
        undefined,
        { now: testNow },
      ),
    ).toEqual([
      "╭─ Subagents (1 active) ───────────────╮",
      "│ @scout-2 00:10 (Analyze auth flow) ● │",
      "╰──────────────────────────────────────╯",
    ]);
    expect(
      formatTodoWidget(
        todos,
        [
          { id: "sub-1", agent: "worker", state: "running" },
          { id: "sub-2", state: "blocked" },
        ],
        [{ id: "task-1", command: "npm test", status: "running" }],
      ),
    ).toEqual([
      "╭─ Todos (1 open, 1 ✓) ─╮",
      "│ • 1 First             │",
      "│ ✓ 2 \x1b[9mSecond\x1b[29m            │",
      "├─ Tasks (1 running) ───┤",
      "│ task-1 ● (npm test)   │",
      "├─ Subagents (2 active) ┤",
      "│ @sub-1 ● (worker)     │",
      "│ @sub-2 ⏸              │",
      "╰───────────────────────╯",
    ]);
  });

  it("formats side-by-side sections when width is at least 80 and both todos and agents exist", () => {
    const wideLines = formatTodoWidget(
      todos,
      [
        { id: "sub-1", agent: "worker", state: "running" },
        { id: "sub-2", state: "blocked" },
      ],
      [{ id: "task-1", command: "npm test", status: "running" }],
      { width: 80 },
    );
    expect(wideLines).toEqual([
      "╭─ Todos (1 open, 1 ✓) ────────────────┬─ Tasks (1 running) ───────────────────╮",
      "│ • 1 First                            │ task-1 ● (npm test)                   │",
      "│ ✓ 2 \x1b[9mSecond\x1b[29m                           ├─ Subagents (2 active) ────────────────┤",
      "│                                      │ @sub-1 ● (worker)                     │",
      "│                                      │ @sub-2 ⏸                              │",
      "╰──────────────────────────────────────┴───────────────────────────────────────╯",
    ]);

    const narrowLines = formatTodoWidget(
      todos,
      [{ id: "sub-1", state: "running" }],
      undefined,
      { width: 60 },
    );
    expect(narrowLines?.[0]).toBe(
      "╭─ Todos (1 open, 1 ✓) ────────────────────────────────────╮",
    );
    expect(narrowLines?.some((l) => l.startsWith("├─ Subagents"))).toBe(true);
  });

  it("starts from a fresh state", () => {
    expect(emptyTodoState()).toEqual({ todos: [], nextId: 1 });
  });
});
