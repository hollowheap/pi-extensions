import { type ListItemNode, parseMarkdownBlocks } from "@hollowheap/core";

export interface Todo {
  id: number;
  text: string;
  done: boolean;
}

export interface TodoState {
  todos: Todo[];
  nextId: number;
}

export type TodoCommand =
  | { type: "create"; texts: string[] }
  | { type: "complete"; ids: number[] };

export interface TodoUpdate {
  state: TodoState;
  unknownIds: number[];
  changed: boolean;
}

const CREATE_TAG = "create_todos";
const COMPLETE_TAG = "complete_todos";
const POSITIVE_ID = /^[1-9]\d*$/;

export function emptyTodoState(): TodoState {
  return { todos: [], nextId: 1 };
}

function orderedItems(body: string): ListItemNode[] | undefined {
  const nodes = parseMarkdownBlocks(body);
  if (nodes.length !== 1) return undefined;

  const node = nodes[0];
  if (node.type !== "list" || !node.ordered || node.items.length === 0) {
    return undefined;
  }

  return node.items;
}

export function parseTodoBlock(
  tag: string,
  body: string,
): TodoCommand | undefined {
  if (tag !== CREATE_TAG && tag !== COMPLETE_TAG) return undefined;

  const items = orderedItems(body);
  if (!items || items.some((item) => item.checked !== undefined)) {
    return undefined;
  }

  if (tag === CREATE_TAG) {
    const texts = items.map((item) => item.text.trim());
    if (texts.some((text) => text.length === 0)) return undefined;
    return { type: "create", texts };
  }

  const ids: number[] = [];
  for (const item of items) {
    const text = item.text.trim();
    if (!POSITIVE_ID.test(text)) return undefined;
    const id = Number(text);
    if (!Number.isSafeInteger(id)) return undefined;
    ids.push(id);
  }

  return { type: "complete", ids };
}

export function applyTodoCommand(
  state: TodoState,
  command: TodoCommand,
): TodoUpdate {
  if (command.type === "create") {
    const todos = [...state.todos];
    let nextId = state.nextId;
    for (const text of command.texts) {
      todos.push({ id: nextId, text, done: false });
      nextId += 1;
    }
    return {
      state: { todos, nextId },
      unknownIds: [],
      changed: command.texts.length > 0,
    };
  }

  const existing = new Set(state.todos.map((todo) => todo.id));
  const requested = new Set(command.ids);
  const seenUnknown = new Set<number>();
  const unknownIds: number[] = [];
  for (const id of command.ids) {
    if (!existing.has(id) && !seenUnknown.has(id)) {
      seenUnknown.add(id);
      unknownIds.push(id);
    }
  }

  let changed = false;
  const todos = state.todos.map((todo) => {
    if (!requested.has(todo.id) || todo.done) return todo;
    changed = true;
    return { ...todo, done: true };
  });

  return {
    state: { todos, nextId: state.nextId },
    unknownIds,
    changed,
  };
}

function byId(todos: readonly Todo[]): Todo[] {
  return [...todos].sort((left, right) => left.id - right.id);
}

export function formatTodoList(todos: readonly Todo[]): string {
  if (todos.length === 0) return "No todos";
  return byId(todos)
    .map((todo) => `#${todo.id} [${todo.done ? "x" : " "}] ${todo.text}`)
    .join("\n");
}

export interface SubagentStateItem {
  id: string;
  agent?: string;
  state: "running" | "blocked" | "complete" | string;
}

const WIDGET_LIMIT = 10;

export interface FormatTodoWidgetOptions {
  strikethrough?: (text: string) => string;
}

export function formatTodoWidget(
  todos: readonly Todo[],
  subagents: readonly SubagentStateItem[] = [],
  options?: FormatTodoWidgetOptions,
): string[] | undefined {
  if (todos.length === 0 && subagents.length === 0) return undefined;

  const strikethrough =
    options?.strikethrough ?? ((text: string) => `\x1b[9m${text}\x1b[29m`);

  const lines: string[] = [];
  if (todos.length > 0) {
    const sorted = byId(todos);
    const openCount = sorted.filter((todo) => !todo.done).length;
    const doneCount = sorted.length - openCount;

    let header: string;
    if (openCount === 0) {
      header = `Todos (${doneCount} done)`;
    } else if (doneCount > 0) {
      header = `Todos (${openCount} open, ${doneCount} done)`;
    } else {
      header = `Todos (${openCount} open)`;
    }
    lines.push(header);

    for (const todo of sorted.slice(0, WIDGET_LIMIT)) {
      if (todo.done) {
        lines.push(`[x] #${todo.id} ${strikethrough(todo.text)}`);
      } else {
        lines.push(`[ ] #${todo.id} ${todo.text}`);
      }
    }
    if (sorted.length > WIDGET_LIMIT) {
      lines.push(`+${sorted.length - WIDGET_LIMIT} more (/todos)`);
    }
  }

  if (subagents.length > 0) {
    lines.push(`Subagents (${subagents.length} active)`);
    for (const sub of subagents) {
      const agentInfo = sub.agent ? ` (${sub.agent})` : "";
      lines.push(`@${sub.id} [${sub.state}]${agentInfo}`);
    }
  }

  return lines;
}

export function formatTodoConfirmation(
  todos: readonly Todo[],
  unknownIds: readonly number[],
): string {
  const lines = ["Todos:", formatTodoList(todos)];
  const unknown = [...new Set(unknownIds)].sort((left, right) => left - right);
  if (unknown.length > 0) {
    lines.push(`Unknown IDs: ${unknown.join(", ")}`);
  }
  return lines.join("\n");
}

export function statusText(todos: readonly Todo[]): string | undefined {
  if (todos.length === 0) return undefined;
  const open = todos.filter((todo) => !todo.done).length;
  return `${open}/${todos.length}`;
}
