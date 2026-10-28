import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
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
    .map((todo) => `${todo.done ? "✓" : "•"} ${todo.id} ${todo.text}`)
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

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatToolDuration(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds > 0 ? `${seconds}s` : ""}`;
}

interface WidgetSection {
  title: string;
  items: string[];
}

export function formatTodoWidget(
  todos: readonly Todo[],
  subagents: readonly SubagentStateItem[] = [],
  tasksOrOptions?: readonly TaskStateItem[] | FormatTodoWidgetOptions,
  options?: FormatTodoWidgetOptions,
): string[] | undefined {
  let tasks: readonly TaskStateItem[] = [];
  let opts: FormatTodoWidgetOptions | undefined;

  if (Array.isArray(tasksOrOptions)) {
    tasks = tasksOrOptions;
    opts = options;
  } else if (tasksOrOptions) {
    opts = tasksOrOptions as FormatTodoWidgetOptions;
  } else {
    opts = options;
  }

  const sections: WidgetSection[] = [];
  const strikethrough =
    opts?.strikethrough ?? ((text: string) => `\x1b[9m${text}\x1b[29m`);

  if (todos.length > 0) {
    const sorted = byId(todos);
    const openCount = sorted.filter((todo) => !todo.done).length;
    const doneCount = sorted.length - openCount;

    let header: string;
    if (openCount === 0) {
      header = `Todos (${doneCount} ✓)`;
    } else if (doneCount > 0) {
      header = `Todos (${openCount} open, ${doneCount} ✓)`;
    } else {
      header = `Todos (${openCount} open)`;
    }

    const items: string[] = [];
    for (const todo of sorted.slice(0, WIDGET_LIMIT)) {
      if (todo.done) {
        items.push(`✓ ${todo.id} ${strikethrough(todo.text)}`);
      } else {
        items.push(`• ${todo.id} ${todo.text}`);
      }
    }
    if (sorted.length > WIDGET_LIMIT) {
      items.push(`+${sorted.length - WIDGET_LIMIT} more (/todos)`);
    }
    sections.push({ title: header, items });
  }

  const runningTasks = tasks.filter((t) => t.status === "running");
  if (runningTasks.length > 0) {
    const items: string[] = [];
    for (const t of runningTasks) {
      const cmdInfo = t.command ? ` (${t.command})` : "";
      items.push(`${t.id} ●${cmdInfo}`);
    }
    sections.push({
      title: `Tasks (${runningTasks.length} running)`,
      items,
    });
  }

  if (subagents.length > 0) {
    const items: string[] = [];
    const now = opts?.now ?? Date.now();
    for (const sub of subagents) {
      if (sub.startedAt !== undefined) {
        const elapsed = formatDuration(now - sub.startedAt);
        const normalizedTask = sub.task
          ? sub.task.replace(/\s+/g, " ").trim()
          : "";
        const taskText = normalizedTask
          ? normalizedTask.length > 25
            ? `${normalizedTask.slice(0, 24)}…`
            : normalizedTask
          : "";
        const taskPart = taskText !== "" ? ` (${taskText})` : "";
        let toolPart = "";
        if (sub.activeTool) {
          const toolTime =
            sub.activeToolStartedAt !== undefined
              ? ` ${formatToolDuration(now - sub.activeToolStartedAt)}`
              : "";
          toolPart = ` · ${sub.activeTool}${toolTime}`;
        }
        items.push(
          `@${sub.id} ${elapsed}${taskPart} ${stateIcon(sub.state)}${toolPart}`,
        );
      } else {
        const agentInfo = sub.agent ? ` (${sub.agent})` : "";
        items.push(`@${sub.id} ${stateIcon(sub.state)}${agentInfo}`);
      }
    }
    sections.push({
      title: `Subagents (${subagents.length} active)`,
      items,
    });
  }

  if (sections.length === 0) return undefined;

  let maxInner = 0;
  for (const s of sections) {
    maxInner = Math.max(maxInner, visibleWidth(s.title) + 5);
    for (const item of s.items) {
      maxInner = Math.max(maxInner, visibleWidth(item) + 4);
    }
  }

  const todoSections = sections.filter((s) => s.title.startsWith("Todos"));
  const otherSections = sections.filter((s) => !s.title.startsWith("Todos"));
  const canSplit =
    (opts?.width ?? 0) >= 80 &&
    todoSections.length > 0 &&
    otherSections.length > 0;

  const b = opts?.borderColor ?? ((s: string) => s);
  const lines: string[] = [];

  if (canSplit) {
    const boxWidth = Math.max(opts?.width ?? 0, 80);
    const col1Width = Math.floor((boxWidth - 1) / 2);
    const col2Width = boxWidth - 1 - col1Width;
    const col1Inner = col1Width - 3;
    const col2Inner = col2Width - 3;

    const leftRows: { text: string }[] = [];
    for (const item of todoSections[0]?.items ?? []) {
      const fit =
        visibleWidth(item) > col1Inner
          ? `${truncateToWidth(item, col1Inner - 1, "")}…`
          : item;
      leftRows.push({ text: fit });
    }

    type RightRow =
      | { type: "item"; text: string }
      | { type: "divider"; title: string };
    const rightRows: RightRow[] = [];
    otherSections.forEach((sec, idx) => {
      if (idx > 0) {
        rightRows.push({ type: "divider", title: sec.title });
      }
      for (const item of sec.items) {
        const fit =
          visibleWidth(item) > col2Inner
            ? `${truncateToWidth(item, col2Inner - 1, "")}…`
            : item;
        rightRows.push({ type: "item", text: fit });
      }
    });

    const title1 = todoSections[0]?.title ?? "";
    const title2 = otherSections[0]?.title ?? "";

    const fill1 = "─".repeat(Math.max(0, col1Width - 4 - visibleWidth(title1)));
    const fill2 = "─".repeat(Math.max(0, col2Width - 4 - visibleWidth(title2)));

    const top = `${b("╭─ ")}${title1}${b(` ${fill1}`)}${b("┬─ ")}${title2}${b(` ${fill2}╮`)}`;
    lines.push(top);

    const rowCount = Math.max(leftRows.length, rightRows.length);
    for (let i = 0; i < rowCount; i++) {
      const leftRow = leftRows[i];
      const leftText = leftRow ? leftRow.text : "";
      const leftPad = " ".repeat(
        Math.max(0, col1Inner - visibleWidth(leftText)),
      );
      const leftCell = `${b("│ ")}${leftText}${leftPad}${b(" ")}`;

      const rightRow = rightRows[i];
      if (rightRow && rightRow.type === "divider") {
        const fillDivider = "─".repeat(
          Math.max(0, col2Width - 4 - visibleWidth(rightRow.title)),
        );
        lines.push(
          `${leftCell}${b("├─ ")}${rightRow.title}${b(` ${fillDivider}┤`)}`,
        );
      } else {
        const rightText = rightRow ? rightRow.text : "";
        const rightPad = " ".repeat(
          Math.max(0, col2Inner - visibleWidth(rightText)),
        );
        lines.push(`${leftCell}${b("│ ")}${rightText}${rightPad}${b(" │")}`);
      }
    }

    const bot = `${b("╰")}${b("─".repeat(col1Width - 1))}${b("┴")}${b("─".repeat(col2Width - 1))}${b("╯")}`;
    lines.push(bot);
    return lines;
  }

  const boxWidth = Math.max(opts?.width ?? 0, maxInner);
  const contentWidth = boxWidth - 4;

  sections.forEach((s, idx) => {
    const titleWidth = visibleWidth(s.title);
    const fillCount = Math.max(0, boxWidth - 5 - titleWidth);
    const fill = "─".repeat(fillCount);
    if (idx === 0) {
      lines.push(`${b("╭─ ")}${s.title}${b(` ${fill}╮`)}`);
    } else {
      lines.push(`${b("├─ ")}${s.title}${b(` ${fill}┤`)}`);
    }
    for (const item of s.items) {
      const itemW = visibleWidth(item);
      const pad = " ".repeat(Math.max(0, contentWidth - itemW));
      lines.push(`${b("│ ")}${item}${pad}${b(" │")}`);
    }
  });

  lines.push(`${b("╰")}${b("─".repeat(boxWidth - 2))}${b("╯")}`);
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
