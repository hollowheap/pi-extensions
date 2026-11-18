import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "@hollowheap/core/format";

export type TodoPriority = "high" | "medium" | "low";

export interface Todo {
  id: number;
  text: string;
  done: boolean;
  priority?: TodoPriority;
}

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
    const lp = PRIORITY_ORDER[left.priority ?? "medium"] ?? 1;
    const rp = PRIORITY_ORDER[right.priority ?? "medium"] ?? 1;
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

export interface SubagentStateItem {
  id: string;
  agent?: string;
  task?: string;
  state: "running" | "blocked" | "complete" | string;
  startedAt?: number;
  activeTool?: string;
  activeToolStartedAt?: number;
}

export interface TaskStateItem {
  id: string;
  command?: string;
  status: "running" | string;
}

const WIDGET_LIMIT = 10;

export interface FormatTodoWidgetOptions {
  strikethrough?: (text: string) => string;
  borderColor?: (text: string) => string;
  width?: number;
  now?: number;
  collapsed?: boolean;
}

function stateIcon(state: string): string {
  switch (state) {
    case "running":
      return "●";
    case "blocked":
      return "⏸";
    case "complete":
      return "✓";
    default:
      return state;
  }
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatToolDuration(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds > 0 ? `${seconds}s` : ""}`;
}

function fitWidth(lines: string[], width: number | undefined): string[] {
  if (width === undefined || width <= 0) return lines;
  return lines.map((line) =>
    visibleWidth(line) > width ? truncateToWidth(line, width, "") : line,
  );
}

export function formatSubagentWidget(
  subagents: readonly SubagentStateItem[],
  options: FormatTodoWidgetOptions = {},
): string[] | undefined {
  if (options.collapsed || subagents.length === 0) return undefined;
  const now = options.now ?? Date.now();
  const lines = [`Subagents (${subagents.length} active)`];
  for (const sub of subagents) {
    const id = sanitizeTerminalText(sub.id);
    if (sub.startedAt !== undefined) {
      const task = sub.task
        ? sanitizeTerminalText(sub.task).replace(/\s+/g, " ").trim()
        : "";
      const taskText = task.length > 25 ? `${task.slice(0, 24)}…` : task;
      const taskPart = task === "" ? "" : ` (${taskText})`;
      const toolPart = sub.activeTool
        ? ` · ${sanitizeTerminalText(sub.activeTool)}${
            sub.activeToolStartedAt !== undefined
              ? ` ${formatToolDuration(now - sub.activeToolStartedAt)}`
              : ""
          }`
        : "";
      lines.push(
        `@${id} ${formatElapsed(now - sub.startedAt)}${taskPart} ${stateIcon(sub.state)}${toolPart}`,
      );
    } else {
      const agent = sub.agent ? ` (${sanitizeTerminalText(sub.agent)})` : "";
      lines.push(`@${id} ${stateIcon(sub.state)}${agent}`);
    }
  }
  return fitWidth(lines, options.width);
}

export function formatTaskWidget(
  tasks: readonly TaskStateItem[],
  options: FormatTodoWidgetOptions = {},
): string[] | undefined {
  if (options.collapsed) return undefined;
  const running = tasks.filter((task) => task.status === "running");
  if (running.length === 0) return undefined;
  const lines = [`Tasks (${running.length} running)`];
  for (const task of running) {
    const command = task.command
      ? ` (${sanitizeTerminalText(task.command)})`
      : "";
    lines.push(`${sanitizeTerminalText(task.id)} ●${command}`);
  }
  return fitWidth(lines, options.width);
}

export function formatTodoWidget(
  todos: readonly Todo[],
  _subagents: readonly SubagentStateItem[] = [],
  _tasks: readonly TaskStateItem[] = [],
  options: FormatTodoWidgetOptions = {},
): string[] | undefined {
  if (options.collapsed || todos.length === 0) return undefined;

  const sorted = byId(todos);
  const open = sorted.filter((todo) => !todo.done);
  const done = sorted.filter((todo) => todo.done);
  const header =
    open.length === 0
      ? `Todos (${done.length} ✓)`
      : done.length > 0
        ? `Todos (${open.length} open, ${done.length} ✓)`
        : `Todos (${open.length} open)`;

  const strikethrough =
    options.strikethrough ?? ((text: string) => `\x1b[9m${text}\x1b[29m`);
  const lines = [header];
  for (const todo of [...open, ...done].slice(0, WIDGET_LIMIT)) {
    const safeText = sanitizeTerminalText(todo.text);
    lines.push(
      todo.done
        ? `✓ ${todo.id} ${strikethrough(safeText)}`
        : `• ${todo.id} ${safeText}`,
    );
  }
  if (sorted.length > WIDGET_LIMIT) {
    lines.push(`+${sorted.length - WIDGET_LIMIT} more (/todos)`);
  }

  return fitWidth(lines, options.width);
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
