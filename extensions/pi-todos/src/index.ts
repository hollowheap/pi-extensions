import {
  type ExtensionAPI,
  type ExtensionContext,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import { Key, Text, matchesKey } from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { roundedFrame } from "@hollowheap/tui/frame";
import { Type } from "typebox";
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
} from "./todos.js";

const TODOS_TYPE = "hollowheap.todos";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSubagentItems(value: unknown): SubagentStateItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: SubagentStateItem[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      entry.id === "" ||
      typeof entry.state !== "string"
    ) {
      continue;
    }
    const item: SubagentStateItem = { id: entry.id, state: entry.state };
    if (typeof entry.agent === "string") item.agent = entry.agent;
    if (typeof entry.task === "string") item.task = entry.task;
    if (
      typeof entry.startedAt === "number" &&
      Number.isFinite(entry.startedAt)
    ) {
      item.startedAt = entry.startedAt;
    }
    if (typeof entry.activeTool === "string")
      item.activeTool = entry.activeTool;
    if (
      typeof entry.activeToolStartedAt === "number" &&
      Number.isFinite(entry.activeToolStartedAt)
    ) {
      item.activeToolStartedAt = entry.activeToolStartedAt;
    }
    items.push(item);
  }
  return items;
}

function readTaskItems(value: unknown): TaskStateItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: TaskStateItem[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      entry.id === "" ||
      typeof entry.status !== "string"
    ) {
      continue;
    }
    const item: TaskStateItem = { id: entry.id, status: entry.status };
    if (typeof entry.command === "string") item.command = entry.command;
    items.push(item);
  }
  return items;
}

function readTodos(value: unknown): Todo[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const todos: Todo[] = [];
  const seen = new Set<number>();
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
    if (seen.has(todo.id)) return undefined;
    seen.add(todo.id);
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

export function createTodoTool(
  getState: () => TodoState,
  setState: (next: TodoState, ctx?: ExtensionContext) => void,
) {
  return defineTool({
    name: "todo",
    label: "todo",
    description:
      "Manage branch-local todos: create, complete, delete, edit, priority, or list tasks.",
    exposure: "codemode",
    promptGuidelines: [
      "Use tools.todo via codemode to track multi-step execution plans: create tasks before complex multi-step work, update status/complete as steps finish.",
      "todo is codemode-only: call it as tools.todo({...}) inside a codemode script, never as a direct top-level tool.",
    ],
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("create"),
        Type.Literal("complete"),
        Type.Literal("delete"),
        Type.Literal("list"),
        Type.Literal("edit"),
        Type.Literal("priority"),
      ]),
      tasks: Type.Optional(
        Type.Array(Type.String(), {
          description: "Task descriptions for create action.",
        }),
      ),
      text: Type.Optional(
        Type.String({
          description: "Single task description for create or edit action.",
        }),
      ),
      ids: Type.Optional(
        Type.Array(Type.Integer({ minimum: 1 }), {
          description: "Task IDs for complete or delete action.",
        }),
      ),
      id: Type.Optional(
        Type.Integer({
          minimum: 1,
          description:
            "Single task ID for complete, delete, edit, or priority action.",
        }),
      ),
      priority: Type.Optional(
        Type.Union(
          [Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")],
          { description: "Priority level for priority action." },
        ),
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const current = getState();
      if (params.action === "list") {
        return {
          content: [
            {
              type: "text" as const,
              text: formatTodoList(current.todos),
            },
          ],
          details: { todos: current.todos },
        };
      }

      if (params.action === "create") {
        const texts = params.tasks ?? (params.text ? [params.text] : []);
        if (texts.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: No tasks provided to create.",
              },
            ],
            details: { todos: current.todos },
          };
        }
        const result = applyTodoCommand(current, { type: "create", texts });
        setState(result.state, ctx);
        return {
          content: [
            {
              type: "text" as const,
              text: formatTodoList(result.state.todos),
            },
          ],
          details: { todos: result.state.todos, created: texts },
        };
      }

      if (params.action === "complete") {
        const ids = params.ids ?? (params.id !== undefined ? [params.id] : []);
        if (ids.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: No task IDs provided to complete.",
              },
            ],
            details: { todos: current.todos },
          };
        }
        const result = applyTodoCommand(current, { type: "complete", ids });
        setState(result.state, ctx);
        return {
          content: [
            {
              type: "text" as const,
              text: formatTodoConfirmation(
                result.state.todos,
                result.unknownIds,
              ),
            },
          ],
          details: {
            todos: result.state.todos,
            unknownIds: result.unknownIds,
          },
        };
      }

      if (params.action === "delete") {
        const ids =
          params.ids ?? (params.id !== undefined ? [params.id] : undefined);
        const result = applyTodoCommand(current, { type: "delete", ids });
        setState(result.state, ctx);
        return {
          content: [
            {
              type: "text" as const,
              text: formatTodoList(result.state.todos),
            },
          ],
          details: { todos: result.state.todos },
        };
      }

      if (params.action === "edit") {
        if (params.id === undefined || !params.text) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Both id and text are required for edit.",
              },
            ],
            details: { todos: current.todos },
          };
        }
        const result = applyTodoCommand(current, {
          type: "edit",
          id: params.id,
          text: params.text,
        });
        setState(result.state, ctx);
        return {
          content: [
            {
              type: "text" as const,
              text: formatTodoList(result.state.todos),
            },
          ],
          details: { todos: result.state.todos },
        };
      }

      if (params.action === "priority") {
        if (params.id === undefined || !params.priority) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Both id and priority are required for priority action.",
              },
            ],
            details: { todos: current.todos },
          };
        }
        const result = applyTodoCommand(current, {
          type: "priority",
          id: params.id,
          priority: params.priority,
        });
        setState(result.state, ctx);
        return {
          content: [
            {
              type: "text" as const,
              text: formatTodoList(result.state.todos),
            },
          ],
          details: { todos: result.state.todos },
        };
      }

      return {
        content: [{ type: "text" as const, text: "Error: Unknown action." }],
        details: { todos: current.todos },
      };
    },
  });
}

export default function (pi: ExtensionAPI) {
  let state: TodoState = emptyTodoState();
  let subagents: SubagentStateItem[] = [];
  let tasks: TaskStateItem[] = [];
  let lastCtx: ExtensionContext | undefined;
  let panelCollapsed = false;
  let lastOpenCount = 0;

  const publishStatusline = (open: number) => {
    lastOpenCount = open;
    pi.events?.emit?.("statusline:values", {
      name: "todos",
      text: open > 0 ? `${open} todo${open === 1 ? "" : "s"}` : "",
    });
  };

  pi.events?.on?.("statusline:request", (data: unknown) => {
    if (typeof data === "object" && data !== null) {
      const names = (data as { names?: unknown }).names;
      if (Array.isArray(names) && !names.includes("todos")) return;
    }
    publishStatusline(lastOpenCount);
  });

  const publishState = (ctx?: ExtensionContext) => {
    const total = state.todos.length;
    const open = state.todos.filter((t) => !t.done).length;
    const done = total - open;
    const highPriority = state.todos.filter(
      (t) => !t.done && t.priority === "high",
    ).length;

    pi.events?.emit?.("todos:state", { todos: state.todos, open, total });
    publishStatusline(open);

    const sessionManager = ctx?.sessionManager ?? lastCtx?.sessionManager;
    if (sessionManager) {
      updateSessionSnapshot(sessionManager, "todos", {
        total,
        open,
        done,
        highPriority,
        items: state.todos.slice(0, 10).map((todo) => ({
          ...todo,
          text: sanitizeTerminalText(todo.text),
        })),
        updatedAt: Date.now(),
      });
    }
  };

  const updateUI = (ctx: ExtensionContext) => {
    lastCtx = ctx;
    if (!ctx.hasUI || typeof ctx.ui.setWidget !== "function") return;
    const strikethrough =
      typeof ctx.ui.theme?.strikethrough === "function"
        ? (text: string) => ctx.ui.theme.strikethrough(text)
        : undefined;
    const borderColor =
      typeof ctx.ui.theme?.fg === "function"
        ? (text: string) => ctx.ui.theme.fg("border", text)
        : undefined;
    const options = strikethrough
      ? { strikethrough, borderColor, collapsed: panelCollapsed }
      : borderColor
        ? { borderColor, collapsed: panelCollapsed }
        : { collapsed: panelCollapsed };
    const preview = formatTodoWidget(state.todos, subagents, tasks, options);
    if (preview === undefined) {
      ctx.ui.setWidget("todos", undefined);
      return;
    }
    ctx.ui.setWidget("todos", () => ({
      render: (width: number) =>
        formatTodoWidget(state.todos, subagents, tasks, {
          ...options,
          width: width >= 80 ? width : 0,
        }) ?? [],
      invalidate: () => {},
    }));
  };

  pi.registerTool(
    createTodoTool(
      () => state,
      (next, context) => {
        state = next;
        pi.appendEntry(TODOS_TYPE, {
          todos: state.todos,
          nextId: state.nextId,
          updatedAt: Date.now(),
        });
        const currentCtx = context ?? lastCtx;
        if (currentCtx) updateUI(currentCtx);
        publishState(currentCtx);
      },
    ),
  );

  pi.events.on("subagents:state", (data: unknown) => {
    const items = readSubagentItems(data);
    if (items === undefined) return;
    subagents = items;
    if (lastCtx?.hasUI) updateUI(lastCtx);
  });

  pi.events.on("tasks:state", (data: unknown) => {
    const items = readTaskItems(data);
    if (items === undefined) return;
    tasks = items;
    if (lastCtx?.hasUI) updateUI(lastCtx);
  });

  const restore = (ctx: ExtensionContext) => {
    state = emptyTodoState();
    try {
      const entries =
        typeof ctx.sessionManager?.getBranch === "function"
          ? ctx.sessionManager.getBranch()
          : typeof ctx.sessionManager?.getEntries === "function"
            ? ctx.sessionManager.getEntries()
            : [];
      for (const entry of entries) {
        if (entry.type !== "custom" || entry.customType !== TODOS_TYPE)
          continue;
        const restored = readState(entry.data);
        if (restored) state = restored;
      }
    } catch {
      // A broken branch should not prevent the session from starting.
    }
    updateUI(ctx);
    publishState(ctx);
  };

  // Prefixed keybinding: Ctrl+X then p toggles panel collapse
  let chordPending = false;
  let chordTimer: ReturnType<typeof setTimeout> | undefined;
  let disposeTerminalInput: (() => void) | undefined;
  const resetChord = () => {
    chordPending = false;
    if (chordTimer !== undefined) {
      clearTimeout(chordTimer);
      chordTimer = undefined;
    }
  };

  const setupTerminalInput = (ctx: ExtensionContext) => {
    disposeTerminalInput?.();
    disposeTerminalInput = undefined;
    resetChord();
    if (!ctx.hasUI || typeof ctx.ui.onTerminalInput !== "function") return;
    disposeTerminalInput = ctx.ui.onTerminalInput((data: string) => {
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
    const active = pi.getActiveTools();
    const next = active.filter((name) => name !== "todo");
    if (pi.getAllTools().some((tool) => tool.name === "codemode")) {
      if (!next.includes("codemode")) next.push("codemode");
    }
    if (
      next.length !== active.length ||
      next.some((name, index) => name !== active[index])
    ) {
      pi.setActiveTools(next);
    }
  });

  pi.on("session_tree", (_event, ctx) => {
    restore(ctx);
    setupTerminalInput(ctx);
  });

  pi.on("session_shutdown", () => {
    disposeTerminalInput?.();
    disposeTerminalInput = undefined;
    resetChord();
    pi.events?.emit?.("statusline:values", { name: "todos", text: "" });
  });

  pi.on("session_compact", () => {
    if (state.todos.length > 0 || state.nextId > 1) {
      pi.appendEntry(TODOS_TYPE, {
        todos: state.todos,
        nextId: state.nextId,
        updatedAt: Date.now(),
      });
    }
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
        await ctx.ui.custom<void>(
          (_tui, theme, _keybindings, done) => ({
            render: (width) => {
              const innerWidth = Math.max(1, width - 4);
              const lines = new Text(
                [text, "", "Esc, Enter, q, or Ctrl+C to close"].join("\n"),
                0,
                0,
              ).render(innerWidth);
              return roundedFrame(lines, width, theme, "Todos");
            },
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
          }),
          {
            overlay: true,
            overlayOptions: { width: "70%", maxHeight: "75%", margin: 1 },
          },
        );
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
            pi.appendEntry(TODOS_TYPE, {
              todos: state.todos,
              nextId: state.nextId,
              updatedAt: Date.now(),
            });
          }
          publishState(ctx);
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
          pi.appendEntry(TODOS_TYPE, {
            todos: state.todos,
            nextId: state.nextId,
            updatedAt: Date.now(),
          });
        }
        publishState(ctx);
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
        pi.appendEntry(TODOS_TYPE, {
          todos: state.todos,
          nextId: state.nextId,
          updatedAt: Date.now(),
        });
        publishState(ctx);
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
          pi.appendEntry(TODOS_TYPE, {
            todos: state.todos,
            nextId: state.nextId,
            updatedAt: Date.now(),
          });
          publishState(ctx);
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
        pi.appendEntry(TODOS_TYPE, {
          todos: state.todos,
          nextId: state.nextId,
          updatedAt: Date.now(),
        });
        publishState(ctx);
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
        pi.appendEntry(TODOS_TYPE, {
          todos: state.todos,
          nextId: state.nextId,
          updatedAt: Date.now(),
        });
        publishState(ctx);
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

  pi.on("before_agent_start", (event, ctx) => {
    if (!ctx?.hasUI) return;
    if (!event.systemPromptOptions) return;
    event.systemPromptOptions.sections =
      event.systemPromptOptions.sections ?? {};
    event.systemPromptOptions.sections.todos_format =
      "Todos are managed via tagged markdown blocks (not a direct tool): " +
      "create with ```create_todos containing an ordered list; " +
      "complete with ```complete_todos containing IDs. " +
      "State is branch-local. Use /todos to view progress.";
  });
}
