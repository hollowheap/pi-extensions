import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Key, Text, matchesKey } from "@earendil-works/pi-tui";
import { scanTaggedBlocks } from "@hollowheap/core";
import {
  type SubagentStateItem,
  type TaskStateItem,
  type Todo,
  type TodoState,
  applyTodoCommand,
  emptyTodoState,
  formatTodoConfirmation,
  formatTodoList,
  formatTodoWidget,
  parseTodoBlock,
} from "./todos.js";

const TODOS_TYPE = "hollowheap.todos";
const UPDATED_TYPE = "hollowheap.todos.updated";

const TODOS_FORMAT = `Todo blocks are tool-free. Do not call a todo tool; none exists.

Create tasks with exactly one ordered list:
\`\`\`create_todos
1. First task
2. Second task
\`\`\`

Complete tasks by numeric ID with exactly one ordered list:
\`\`\`complete_todos
1. 2
\`\`\`

Delete all completed todos with an empty block:
\`\`\`delete_todos
\`\`\`

create_todos appends tasks and assigns stable numeric IDs; it never replaces the list. Do not use checkboxes or unordered lists. complete_todos marks the listed IDs done and reports unknown IDs. delete_todos clears all todos only when every todo is done. After a change, a follow-up message lists every todo with its ID and done marker so you can learn the assigned IDs. /todos shows the current list.`;

interface TodoDetails {
  todos: Todo[];
  unknownIds: number[];
}

function contentText(
  content: string | readonly { type: string; text?: string }[],
): string {
  if (typeof content === "string") return content;
  return content
    .flatMap((part) =>
      part.type === "text" && typeof part.text === "string" ? [part.text] : [],
    )
    .join("\n");
}

function detailsText(details: unknown): string | undefined {
  if (details === null || typeof details !== "object") return undefined;
  const value = details as { todos?: unknown; unknownIds?: unknown };
  const todos = readTodos(value.todos);
  if (!todos) return undefined;
  const unknownIds = Array.isArray(value.unknownIds)
    ? value.unknownIds.filter(
        (id): id is number =>
          typeof id === "number" && Number.isSafeInteger(id) && id >= 1,
      )
    : [];
  return formatTodoConfirmation(todos, unknownIds);
}

function stripTodoBlocks(markdown: string, isStreaming: boolean): string {
  const blocks = scanTaggedBlocks(markdown);
  let result = markdown;

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (
      block.tag !== "create_todos" &&
      block.tag !== "complete_todos" &&
      block.tag !== "delete_todos"
    ) {
      continue;
    }

    const remove = block.closed
      ? parseTodoBlock(block.tag, block.body) !== undefined
      : isStreaming;
    if (!remove) continue;

    const end = result[block.end] === "\n" ? block.end + 1 : block.end;
    result = result.slice(0, block.start) + result.slice(end);
  }

  return result;
}

function readTodos(value: unknown): Todo[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const todos: Todo[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") return undefined;
    const todo = item as {
      id?: unknown;
      text?: unknown;
      done?: unknown;
      priority?: unknown;
    };
    if (
      typeof todo.id !== "number" ||
      !Number.isSafeInteger(todo.id) ||
      todo.id < 1 ||
      typeof todo.text !== "string" ||
      typeof todo.done !== "boolean"
    ) {
      return undefined;
    }
    const priority =
      todo.priority === "high" ||
      todo.priority === "medium" ||
      todo.priority === "low"
        ? todo.priority
        : undefined;
    todos.push({
      id: todo.id,
      text: todo.text,
      done: todo.done,
      priority,
    });
  }
  return todos;
}

function readState(data: unknown): TodoState | undefined {
  if (data === null || typeof data !== "object") return undefined;
  const value = data as { todos?: unknown; nextId?: unknown };
  if (
    typeof value.nextId !== "number" ||
    !Number.isSafeInteger(value.nextId) ||
    value.nextId < 1
  ) {
    return undefined;
  }

  const todos = readTodos(value.todos);
  if (!todos) return undefined;

  const maxId = todos.reduce((max, todo) => Math.max(max, todo.id), 0);
  return { todos, nextId: Math.max(value.nextId, maxId + 1) };
}

export default function (pi: ExtensionAPI) {
  const handled = new WeakSet<object>();
  let state: TodoState = emptyTodoState();
  let subagents: SubagentStateItem[] = [];
  let tasks: TaskStateItem[] = [];
  let lastCtx: ExtensionContext | undefined;
  let panelCollapsed = false;

  const updateUI = (ctx: ExtensionContext) => {
    lastCtx = ctx;
    if (!ctx.hasUI) return;
    const strikethrough =
      typeof ctx.ui.theme?.strikethrough === "function"
        ? (text: string) => ctx.ui.theme.strikethrough(text)
        : undefined;
    const borderColor =
      typeof ctx.ui.theme?.fg === "function"
        ? (text: string) => ctx.ui.theme.fg("border", text)
        : undefined;
    ctx.ui.setWidget(
      "todos",
      formatTodoWidget(
        state.todos,
        subagents,
        tasks,
        strikethrough
          ? { strikethrough, borderColor, collapsed: panelCollapsed }
          : borderColor
            ? { borderColor, collapsed: panelCollapsed }
            : { collapsed: panelCollapsed },
      ),
    );
  };

  pi.events.on("subagents:state", (data: unknown) => {
    if (Array.isArray(data)) {
      subagents = data as SubagentStateItem[];
      if (lastCtx?.hasUI) {
        updateUI(lastCtx);
      }
    }
  });

  pi.events.on("tasks:state", (data: unknown) => {
    if (Array.isArray(data)) {
      tasks = data as TaskStateItem[];
      if (lastCtx?.hasUI) {
        updateUI(lastCtx);
      }
    }
  });

  const restore = (ctx: ExtensionContext) => {
    state = emptyTodoState();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== TODOS_TYPE) continue;
      const restored = readState(entry.data);
      if (restored) state = restored;
    }
    updateUI(ctx);
  };

  pi.registerMessageRenderer<TodoDetails>(UPDATED_TYPE, (message, options) => {
    const text = detailsText(message.details) ?? contentText(message.content);
    return new Text(text, options.outputPad, 0);
  });

  pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType !== "assistant") return markdown;
    return stripTodoBlocks(markdown, context.isStreaming);
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (!ctx.hasUI) return;
    event.systemPromptOptions.sections.todos_format = TODOS_FORMAT;
  });

  // Prefixed keybinding: Ctrl+X then p toggles panel collapse
  let chordPending = false;
  let chordTimer: ReturnType<typeof setTimeout> | undefined;
  const resetChord = () => {
    chordPending = false;
    if (chordTimer !== undefined) {
      clearTimeout(chordTimer);
      chordTimer = undefined;
    }
  };

  const setupTerminalInput = (ctx: ExtensionContext) => {
    if (!ctx.hasUI || typeof ctx.ui.onTerminalInput !== "function") return;
    ctx.ui.onTerminalInput((data: string) => {
      if (chordPending) {
        resetChord();
        if (data === "p" || data === "P") {
          panelCollapsed = !panelCollapsed;
          if (lastCtx?.hasUI) updateUI(lastCtx);
          return { consume: true };
        }
        return { consume: false };
      }
      if (data === "\x18") {
        chordPending = true;
        chordTimer = setTimeout(resetChord, 1500);
        return { consume: true };
      }
      return { consume: false };
    });
  };

  pi.on("session_start", (_event, ctx) => {
    restore(ctx);
    setupTerminalInput(ctx);
  });
  pi.on("session_tree", (_event, ctx) => {
    restore(ctx);
    setupTerminalInput(ctx);
  });

  pi.on("message_end", (event, ctx) => {
    if (!ctx.hasUI || event.message.role !== "assistant") return;

    const commands = scanTaggedBlocks(
      contentText(event.message.content),
    ).flatMap((block) => {
      if (!block.closed) return [];
      const command = parseTodoBlock(block.tag, block.body);
      return command ? [command] : [];
    });

    if (commands.length === 0 || handled.has(event.message)) return;
    handled.add(event.message);

    let next = state;
    let changed = false;
    const unknownIds: number[] = [];
    for (const command of commands) {
      const result = applyTodoCommand(next, command);
      next = result.state;
      changed ||= result.changed;
      unknownIds.push(...result.unknownIds);
    }

    state = next;
    updateUI(ctx);
    if (changed) {
      pi.appendEntry(TODOS_TYPE, state);
    }

    const uniqueUnknownIds = [...new Set(unknownIds)].sort(
      (left, right) => left - right,
    );
    pi.sendMessage(
      {
        customType: UPDATED_TYPE,
        content: formatTodoConfirmation(state.todos, uniqueUnknownIds),
        display: true,
        details: { todos: state.todos, unknownIds: uniqueUnknownIds },
      },
      { deliverAs: "followUp" },
    );
  });

  pi.registerCommand("todos", {
    description: "Show all todos on the current branch; /todos search <query>",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      let displayTodos = state.todos;
      if (trimmed.toLowerCase().startsWith("search ")) {
        const query = trimmed.slice(7).trim().toLowerCase();
        displayTodos = state.todos.filter((todo) =>
          todo.text.toLowerCase().includes(query),
        );
      }
      const text = formatTodoList(displayTodos);

      if (ctx.mode === "tui" && typeof ctx.ui.custom === "function") {
        await ctx.ui.custom<void>((_tui, _theme, _keybindings, done) => ({
          render: (width) =>
            new Text(
              ["Todos", "", text, "", "Esc, Enter, q, or Ctrl+C to close"].join(
                "\n",
              ),
              0,
              0,
            ).render(width),
          invalidate: () => {},
          handleInput: (data) => {
            if (
              matchesKey(data, Key.escape) ||
              matchesKey(data, Key.enter) ||
              matchesKey(data, Key.ctrl("c")) ||
              data === "q"
            ) {
              done(undefined);
            }
          },
        }));
        return;
      }

      if (ctx.hasUI) ctx.ui.notify(text, "info");
    },
  });

  pi.registerCommand("todo", {
    description: "Manage todos: /todo complete <id>, /todo delete [id]",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            "Usage: /todo complete <id> | /todo delete [id]",
            "info",
          );
        }
        return;
      }

      const subcommand = parts[0];

      if (subcommand === "complete") {
        if (parts[1]?.toLowerCase() === "all") {
          const ids = state.todos.filter((t) => !t.done).map((t) => t.id);
          if (ids.length === 0) {
            if (ctx.hasUI) ctx.ui.notify("No open todos to complete", "info");
            return;
          }
          const result = applyTodoCommand(state, { type: "complete", ids });
          state = result.state;
          updateUI(ctx);
          if (result.changed) {
            pi.appendEntry(TODOS_TYPE, state);
          }
          if (ctx.hasUI) ctx.ui.notify(formatTodoList(state.todos), "info");
          return;
        }

        const idStr = parts[1];
        const id = Number(idStr);
        if (!idStr || !Number.isSafeInteger(id) || id < 1) {
          if (ctx.hasUI) ctx.ui.notify("Invalid ID", "error");
          return;
        }

        const result = applyTodoCommand(state, { type: "complete", ids: [id] });
        state = result.state;
        updateUI(ctx);
        if (result.changed) {
          pi.appendEntry(TODOS_TYPE, state);
        }
        if (ctx.hasUI) ctx.ui.notify(formatTodoList(state.todos), "info");
        return;
      }

      if (subcommand === "edit") {
        const idStr = parts[1];
        const id = Number(idStr);
        const newText = parts.slice(2).join(" ").trim();
        if (
          !idStr ||
          !Number.isSafeInteger(id) ||
          id < 1 ||
          newText.length === 0
        ) {
          if (ctx.hasUI)
            ctx.ui.notify("Usage: /todo edit <id> <text>", "error");
          return;
        }

        const exists = state.todos.some((t) => t.id === id);
        if (!exists) {
          if (ctx.hasUI) ctx.ui.notify(`Unknown ID: ${id}`, "error");
          return;
        }

        state = {
          todos: state.todos.map((t) =>
            t.id === id ? { ...t, text: newText } : t,
          ),
          nextId: state.nextId,
        };
        updateUI(ctx);
        pi.appendEntry(TODOS_TYPE, state);
        if (ctx.hasUI) ctx.ui.notify(formatTodoList(state.todos), "info");
        return;
      }

      if (subcommand === "delete") {
        if (parts.length === 1) {
          // Clear completed todos
          const hasCompleted = state.todos.some((todo) => todo.done);
          if (!hasCompleted) {
            if (ctx.hasUI) {
              ctx.ui.notify("No completed todos to delete", "info");
            }
            return;
          }
          state = {
            todos: state.todos.filter((todo) => !todo.done),
            nextId: state.nextId,
          };
          updateUI(ctx);
          pi.appendEntry(TODOS_TYPE, state);
          if (ctx.hasUI) ctx.ui.notify(formatTodoList(state.todos), "info");
          return;
        }

        const idStr = parts[1];
        const id = Number(idStr);
        if (!idStr || !Number.isSafeInteger(id) || id < 1) {
          if (ctx.hasUI) ctx.ui.notify("Invalid ID", "error");
          return;
        }

        const exists = state.todos.some((todo) => todo.id === id);
        if (!exists) {
          if (ctx.hasUI) ctx.ui.notify(`Unknown ID: ${id}`, "error");
          return;
        }

        state = {
          todos: state.todos.filter((todo) => todo.id !== id),
          nextId: state.nextId,
        };
        updateUI(ctx);
        pi.appendEntry(TODOS_TYPE, state);
        if (ctx.hasUI) ctx.ui.notify(formatTodoList(state.todos), "info");
        return;
      }

      if (subcommand === "priority") {
        const idStr = parts[1];
        const id = Number(idStr);
        const level = parts[2]?.toLowerCase();
        if (
          !idStr ||
          !Number.isSafeInteger(id) ||
          id < 1 ||
          (level !== "high" && level !== "medium" && level !== "low")
        ) {
          if (ctx.hasUI) {
            ctx.ui.notify(
              "Usage: /todo priority <id> <high|medium|low>",
              "error",
            );
          }
          return;
        }

        const exists = state.todos.some((t) => t.id === id);
        if (!exists) {
          if (ctx.hasUI) ctx.ui.notify(`Unknown ID: ${id}`, "error");
          return;
        }

        state = {
          todos: state.todos.map((t) =>
            t.id === id
              ? { ...t, priority: level as "high" | "medium" | "low" }
              : t,
          ),
          nextId: state.nextId,
        };
        updateUI(ctx);
        pi.appendEntry(TODOS_TYPE, state);
        if (ctx.hasUI) ctx.ui.notify(formatTodoList(state.todos), "info");
        return;
      }

      if (ctx.hasUI) {
        ctx.ui.notify(
          "Usage: /todo complete <id> | /todo delete [id] | /todo edit <id> <text> | /todo priority <id> <level>",
          "info",
        );
      }
    },
  });

  pi.registerCommand("panel", {
    description: "Toggle sticky panel: /panel toggle [todos|dashboard|all]",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts[0] !== "toggle") {
        if (ctx.hasUI) {
          ctx.ui.notify("Usage: /panel toggle [todos|dashboard|all]", "info");
        }
        return;
      }
      panelCollapsed = !panelCollapsed;
      if (ctx.hasUI) {
        updateUI(ctx);
        ctx.ui.notify(
          panelCollapsed ? "Panel collapsed" : "Panel expanded",
          "info",
        );
      }
    },
  });
}
