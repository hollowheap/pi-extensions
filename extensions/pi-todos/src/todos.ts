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
  tasks: readonly TaskStateItem[] = [],
  options: FormatTodoWidgetOptions = {},
): string[] | undefined {
  const opts = options;
  if (opts.collapsed) return undefined;

  const sections: WidgetSection[] = [];
  const strikethrough =
    opts?.strikethrough ?? ((text: string) => `\x1b[9m${text}\x1b[29m`);

  if (todos.length > 0) {
    const sorted = byId(todos);
    const open = sorted.filter((todo) => !todo.done);
    const done = sorted.filter((todo) => todo.done);
    const openCount = open.length;
    const doneCount = done.length;

    let header: string;
    if (openCount === 0) {
      header = `Todos (${doneCount} ✓)`;
    } else if (doneCount > 0) {
      header = `Todos (${openCount} open, ${doneCount} ✓)`;
    } else {
      header = `Todos (${openCount} open)`;
    }

    const items: string[] = [];
    for (const todo of [...open, ...done].slice(0, WIDGET_LIMIT)) {
      const safeText = sanitizeTerminalText(todo.text);
      if (todo.done) {
        items.push(`✓ ${todo.id} ${strikethrough(safeText)}`);
      } else {
        items.push(`• ${todo.id} ${safeText}`);
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
      const cmdInfo = t.command ? ` (${sanitizeTerminalText(t.command)})` : "";
      items.push(`${sanitizeTerminalText(t.id)} ●${cmdInfo}`);
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
      const subId = sanitizeTerminalText(sub.id);
      if (sub.startedAt !== undefined) {
        const elapsed = formatDuration(now - sub.startedAt);
        const normalizedTask = sub.task
          ? sanitizeTerminalText(sub.task).replace(/\s+/g, " ").trim()
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
          toolPart = ` · ${sanitizeTerminalText(sub.activeTool)}${toolTime}`;
        }
        items.push(
          `@${subId} ${elapsed}${taskPart} ${stateIcon(sub.state)}${toolPart}`,
        );
      } else {
        const agentInfo = sub.agent
          ? ` (${sanitizeTerminalText(sub.agent)})`
          : "";
        items.push(`@${subId} ${stateIcon(sub.state)}${agentInfo}`);
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
    for (const item of todoSections.flatMap((section) => section.items)) {
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

    const title1 = todoSections.map((section) => section.title).join(" · ");
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
          `${leftCell}${b("┼─ ")}${rightRow.title}${b(` ${fillDivider}┤`)}`,
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

  const boxWidth =
    opts?.width !== undefined && opts.width > 0 ? opts.width : maxInner;
  const contentWidth = Math.max(0, boxWidth - 4);

  sections.forEach((s, idx) => {
    const rawTitle = s.title;
    const maxTitleW = Math.max(0, boxWidth - 5);
    const fitTitle =
      visibleWidth(rawTitle) > maxTitleW
        ? `${truncateToWidth(rawTitle, Math.max(0, maxTitleW - 1), "")}…`
        : rawTitle;
    const titleWidth = visibleWidth(fitTitle);
    const fillCount = Math.max(0, boxWidth - 5 - titleWidth);
    const fill = "─".repeat(fillCount);
    if (idx === 0) {
      lines.push(`${b("╭─ ")}${fitTitle}${b(` ${fill}╮`)}`);
    } else {
      lines.push(`${b("├─ ")}${fitTitle}${b(` ${fill}┤`)}`);
    }
    for (const item of s.items) {
      const fit =
        visibleWidth(item) > contentWidth
          ? `${truncateToWidth(item, Math.max(0, contentWidth - 1), "")}…`
          : item;
      const itemW = visibleWidth(fit);
      const pad = " ".repeat(Math.max(0, contentWidth - itemW));
      lines.push(`${b("│ ")}${fit}${pad}${b(" │")}`);
    }
  });

  lines.push(`${b("╰")}${b("─".repeat(Math.max(0, boxWidth - 2)))}${b("╯")}`);
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
