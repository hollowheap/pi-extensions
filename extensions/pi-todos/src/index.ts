import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Key, Text, matchesKey } from "@earendil-works/pi-tui";
import { scanTaggedBlocks } from "@hollowheap/core";
import {
  type SubagentStateItem,
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
'''create_todos
1. First task
2. Second task
'''

Complete tasks by numeric ID with exactly one ordered list:
'''complete_todos
1. 2
'''

create_todos appends tasks and assigns stable numeric IDs; it never replaces the list. Do not use checkboxes or unordered lists. complete_todos marks the listed IDs done and reports unknown IDs. After a change, a follow-up message lists every todo with its ID and done marker so you can learn the assigned IDs. /todos shows the current list.`;

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
    if (block.tag !== "create_todos" && block.tag !== "complete_todos") {
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
    const todo = item as { id?: unknown; text?: unknown; done?: unknown };
    if (
      typeof todo.id !== "number" ||
      !Number.isSafeInteger(todo.id) ||
      todo.id < 1 ||
      typeof todo.text !== "string" ||
      typeof todo.done !== "boolean"
    ) {
      return undefined;
    }
    todos.push({ id: todo.id, text: todo.text, done: todo.done });
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
  let lastCtx: ExtensionContext | undefined;

  const updateUI = (ctx: ExtensionContext) => {
    lastCtx = ctx;
    if (!ctx.hasUI) return;
    ctx.ui.setWidget("todos", formatTodoWidget(state.todos, subagents));
  };

  pi.events.on("subagents:state", (data: unknown) => {
    if (Array.isArray(data)) {
      subagents = data as SubagentStateItem[];
      if (lastCtx?.hasUI) {
        lastCtx.ui.setWidget("todos", formatTodoWidget(state.todos, subagents));
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

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));

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
    description: "Show all todos on the current branch",
    handler: async (_args, ctx) => {
      const text = formatTodoList(state.todos);

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
}
