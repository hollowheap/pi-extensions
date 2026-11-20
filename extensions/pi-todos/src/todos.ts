import { sanitizeTerminalText } from "@hollowheap/core/format";
import type { WidgetTodo } from "@hollowheap/ui/widget";

export type TodoPriority = "high" | "medium" | "low";

export type Todo = WidgetTodo;

export interface TodoState {
  todos: Todo[];
  nextId: number;
}

export type TodoCommand =
  | { type: "create"; texts: string[] }
  | { type: "complete"; ids: number[] }
  | { type: "delete"; ids?: number[] }
  | { type: "edit"; id: number; text: string }
  | { type: "priority"; id: number; priority: TodoPriority };

export interface TodoUpdate {
  state: TodoState;
  unknownIds: number[];
  changed: boolean;
}

export function emptyTodoState(): TodoState {
  return { todos: [], nextId: 1 };
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

  if (command.type === "delete") {
    if (command.ids && command.ids.length > 0) {
      const toDelete = new Set(command.ids);
      const todos = state.todos.filter((todo) => !toDelete.has(todo.id));
      const changed = todos.length !== state.todos.length;
      return {
        state: { todos, nextId: state.nextId },
        unknownIds: [],
        changed,
      };
    }
    if (state.todos.length === 0 || state.todos.some((todo) => !todo.done)) {
      return { state, unknownIds: [], changed: false };
    }
    return {
      state: { todos: [], nextId: state.nextId },
      unknownIds: [],
      changed: true,
    };
  }

  if (command.type === "edit") {
    let changed = false;
    const todos = state.todos.map((todo) => {
      if (todo.id === command.id) {
        changed = true;
        return { ...todo, text: command.text };
      }
      return todo;
    });
    return {
      state: { todos, nextId: state.nextId },
      unknownIds: changed ? [] : [command.id],
      changed,
    };
  }

  if (command.type === "priority") {
    let changed = false;
    const todos = state.todos.map((todo) => {
      if (todo.id === command.id) {
        changed = true;
        return { ...todo, priority: command.priority };
      }
      return todo;
    });
    return {
      state: { todos, nextId: state.nextId },
      unknownIds: changed ? [] : [command.id],
      changed,
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

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function byId(todos: readonly Todo[]): Todo[] {
  return [...todos].sort((left, right) => {
    const leftKey = left.priority ?? "medium";
    const rightKey = right.priority ?? "medium";
    const lp = Object.hasOwn(PRIORITY_ORDER, leftKey)
      ? PRIORITY_ORDER[leftKey]
      : 1;
    const rp = Object.hasOwn(PRIORITY_ORDER, rightKey)
      ? PRIORITY_ORDER[rightKey]
      : 1;
    if (lp !== rp) return lp - rp;
    return left.id - right.id;
  });
}

export function formatTodoList(todos: readonly Todo[]): string {
  if (todos.length === 0) return "No todos";
  return byId(todos)
    .map((todo) => {
      const prio = todo.priority ? `[${todo.priority}] ` : "";
      return `${todo.done ? "✓" : "•"} ${todo.id} ${prio}${sanitizeTerminalText(todo.text)}`;
    })
    .join("\n");
}

export type {
  WidgetFormatOptions as FormatTodoWidgetOptions,
  WidgetSubagentStateItem as SubagentStateItem,
  WidgetTaskStateItem as TaskStateItem,
} from "@hollowheap/ui/widget";
export {
  formatSubagentWidget,
  formatTaskWidget,
  formatTodoWidget,
} from "@hollowheap/ui/widget";

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
