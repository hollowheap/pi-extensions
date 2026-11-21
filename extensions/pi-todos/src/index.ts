import {
  type ExtensionAPI,
  type ExtensionContext,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import { sanitizeTerminalText, toolTextResult } from "@hollowheap/core/format";
import { isPromptLockHeld, withPromptLock } from "@hollowheap/core/prompt-lock";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { appendSessionEntry, readBranchEntries } from "@hollowheap/core/state";
import { createStatuslinePublisher } from "@hollowheap/core/statusline";
import {
  canOverlay,
  hostUi,
  infoPopupText,
  notify,
  showInfoPopup,
} from "@hollowheap/pi-ui/host";
import { prefixCompletions } from "@hollowheap/ui/autocomplete";
import {
  formatTodoWidget,
  listWidgetProviders,
  mountWidgetProviders,
  registerWidgetProvider,
  toggleWidgets as toggleRegisteredWidgets,
  widgetChordTarget,
} from "@hollowheap/ui/widget";
import { Type } from "typebox";
import {
  type Todo,
  type TodoState,
  applyTodoCommand,
  emptyTodoState,
  formatTodoConfirmation,
  formatTodoList,
} from "./todos.js";

const TODOS_TYPE = "hollowheap.todos";
const WIDGET_PREFIX = Key.alt("w");
const WIDGET_TARGETS = ["todos", "tasks", "subagents", "all"] as const;
const CHORD_KEYS = {
  b: ["b", Key.shift("b")],
  p: ["p", Key.shift("p")],
  s: ["s", Key.shift("s")],
  t: ["t", Key.shift("t")],
} as const;

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
  setState: (
    next: TodoState,
    ctx?: ExtensionContext,
    changed?: boolean,
  ) => void,
) {
  return defineTool({
    name: "todo",
    label: "todo",
    description:
      "Manage branch-local todos: create, complete, delete, edit, priority, or list tasks.",
    exposure: "codemode",
    promptGuidelines: [
      "Use tools.todo via codemode to track multi-step execution plans: create tasks before complex multi-step work, update status/complete as steps finish.",
      'todo is codemode-only: call it as tools.todo(["step 1", "step 2"]), tools.todo("list"), or tools.todo({...}) inside a codemode script, never as a direct top-level tool.',
    ],
    parameters: Type.Union([
      Type.Literal("list", { description: "List all todos shorthand." }),
      Type.Array(Type.String(), {
        description: "Task descriptions to create shorthand.",
      }),
      Type.Object({
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
    ]),
    async execute(_id, rawParams, _signal, _onUpdate, ctx) {
      const params =
        rawParams === "list"
          ? { action: "list" as const }
          : Array.isArray(rawParams)
            ? { action: "create" as const, tasks: rawParams }
            : rawParams;
      const current = getState();
      if (params.action === "list") {
        return toolTextResult(formatTodoList(current.todos), {
          todos: current.todos,
        });
      }

      if (params.action === "create") {
        const texts = params.tasks ?? (params.text ? [params.text] : []);
        if (texts.length === 0) {
          return toolTextResult("Error: No tasks provided to create.", {
            todos: current.todos,
          });
        }
        const result = applyTodoCommand(current, { type: "create", texts });
        setState(result.state, ctx, result.changed);
        return toolTextResult(formatTodoList(result.state.todos), {
          todos: result.state.todos,
          created: texts,
        });
      }

      if (params.action === "complete") {
        const ids = params.ids ?? (params.id !== undefined ? [params.id] : []);
        if (ids.length === 0) {
          return toolTextResult("Error: No task IDs provided to complete.", {
            todos: current.todos,
          });
        }
        const result = applyTodoCommand(current, { type: "complete", ids });
        setState(result.state, ctx, result.changed);
        return toolTextResult(
          formatTodoConfirmation(result.state.todos, result.unknownIds),
          {
            todos: result.state.todos,
            unknownIds: result.unknownIds,
          },
        );
      }

      if (params.action === "delete") {
        const ids =
          params.ids ?? (params.id !== undefined ? [params.id] : undefined);
        const result = applyTodoCommand(current, { type: "delete", ids });
        setState(result.state, ctx, result.changed);
        return toolTextResult(formatTodoList(result.state.todos), {
          todos: result.state.todos,
        });
      }

      if (params.action === "edit") {
        if (params.id === undefined || !params.text) {
          return toolTextResult(
            "Error: Both id and text are required for edit.",
            {
              todos: current.todos,
            },
          );
        }
        const result = applyTodoCommand(current, {
          type: "edit",
          id: params.id,
          text: params.text,
        });
        setState(result.state, ctx, result.changed);
        return toolTextResult(
          formatTodoConfirmation(result.state.todos, result.unknownIds),
          {
            todos: result.state.todos,
            unknownIds: result.unknownIds,
          },
        );
      }

      if (params.action === "priority") {
        if (params.id === undefined || !params.priority) {
          return toolTextResult(
            "Error: Both id and priority are required for priority action.",
            { todos: current.todos },
          );
        }
        const result = applyTodoCommand(current, {
          type: "priority",
          id: params.id,
          priority: params.priority,
        });
        setState(result.state, ctx, result.changed);
        return toolTextResult(
          formatTodoConfirmation(result.state.todos, result.unknownIds),
          {
            todos: result.state.todos,
            unknownIds: result.unknownIds,
          },
        );
      }

      return toolTextResult("Error: Unknown action.", {
        todos: current.todos,
      });
    },
  });
}

export default function (pi: ExtensionAPI) {
  let state: TodoState = emptyTodoState();
  let lastCtx: ExtensionContext | undefined;
  let lastOpenCount = 0;

  registerWidgetProvider({
    name: "todos",
    label: "Todos",
    render(width, theme) {
      const strikethrough =
        typeof theme?.strikethrough === "function"
          ? (text: string) => theme.strikethrough(text)
          : undefined;
      return formatTodoWidget(state.todos, [], [], {
        width: width >= 80 ? width : 0,
        strikethrough,
      });
    },
  });

  const statusline = createStatuslinePublisher(pi.events, "todos", () =>
    lastOpenCount > 0
      ? `${lastOpenCount} todo${lastOpenCount === 1 ? "" : "s"}`
      : "",
  );

  const publishStatusline = (open: number) => {
    lastOpenCount = open;
    statusline.publish();
  };

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
    if (!ctx.hasUI || typeof hostUi(ctx).setWidget !== "function") return;
    mountWidgetProviders(ctx);
  };

  pi.registerTool(
    createTodoTool(
      () => state,
      (next, context, changed = true) => {
        state = next;
        if (!changed) return;
        appendSessionEntry(
          pi,
          (context ?? lastCtx)?.sessionManager,
          TODOS_TYPE,
          {
            todos: state.todos,
            nextId: state.nextId,
            updatedAt: Date.now(),
          },
        );
        const currentCtx = context ?? lastCtx;
        if (currentCtx) updateUI(currentCtx);
        publishState(currentCtx);
      },
    ),
  );

  const restore = (ctx: ExtensionContext) => {
    state = emptyTodoState();
    const entries = readBranchEntries(ctx.sessionManager) ?? [];
    for (const entry of entries) {
      if (
        (entry as { type?: unknown }).type !== "custom" ||
        entry.customType !== TODOS_TYPE
      )
        continue;
      const restored = readState(entry.data);
      if (restored) state = restored;
    }
    updateUI(ctx);
    publishState(ctx);
  };

  let chordTimer: ReturnType<typeof setTimeout> | undefined;
  let disposeTerminalInput: (() => void) | undefined;
  const resetChord = () => {
    if (chordTimer !== undefined) {
      clearTimeout(chordTimer);
      chordTimer = undefined;
    }
  };

  pi.registerShortcut?.(WIDGET_PREFIX, {
    description:
      "Then P (all), T todos, B tasks, or S subagents to toggle sticky widgets",
    handler: () => {
      resetChord();
      if (!disposeTerminalInput || isPromptLockHeld()) return;
      chordTimer = setTimeout(resetChord, 1500);
    },
  });

  const setupTerminalInput = (ctx: ExtensionContext) => {
    disposeTerminalInput?.();
    disposeTerminalInput = undefined;
    resetChord();
    if (!ctx.hasUI || typeof hostUi(ctx).onTerminalInput !== "function") return;
    disposeTerminalInput = hostUi(ctx).onTerminalInput((data: string) => {
      if (isPromptLockHeld()) {
        resetChord();
        return { consume: false };
      }
      if (chordTimer !== undefined) {
        resetChord();
        const key = data.toLowerCase();
        const ids = Object.hasOwn(CHORD_KEYS, key)
          ? CHORD_KEYS[key as keyof typeof CHORD_KEYS]
          : undefined;
        if (
          ids === undefined ||
          (!matchesKey(data, ids[0]) && !matchesKey(data, ids[1]))
        ) {
          return { consume: false };
        }
        const target = key === "p" ? undefined : widgetChordTarget(key);
        if (
          target === null ||
          (target !== undefined && !listWidgetProviders().includes(target))
        ) {
          return { consume: false };
        }
        toggleRegisteredWidgets(target);
        if (lastCtx?.hasUI) updateUI(lastCtx);
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
    lastOpenCount = 0;
    statusline.publish("");
  });

  pi.on("session_compact", (_event, ctx) => {
    if (state.todos.length > 0 || state.nextId > 1) {
      appendSessionEntry(
        pi,
        ctx?.sessionManager ?? lastCtx?.sessionManager,
        TODOS_TYPE,
        {
          todos: state.todos,
          nextId: state.nextId,
          updatedAt: Date.now(),
        },
      );
    }
  });

  const showTodos = async (todos: readonly Todo[], ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    const text = formatTodoList(todos);

    if (canOverlay(ctx)) {
      resetChord();
      await withPromptLock(() =>
        showInfoPopup(ctx, {
          title: "Todos",
          render: infoPopupText([
            text,
            "",
            "Esc, Enter, q, or Ctrl+C to close",
          ]),
          closeKeys: ["q"],
        }),
      );
      return;
    }

    notify(ctx, text, "info");
  };

  const todoCommand = {
    description: "View, search, and manage todos on the current branch",
    handler: async (args: string, ctx: ExtensionContext) => {
      const trimmed = args.trim();
      if (trimmed === "") return showTodos(state.todos, ctx);

      const parts = trimmed.split(/\s+/);
      const subcommand = parts[0];
      if (subcommand?.toLowerCase() === "search") {
        const query = trimmed.slice(subcommand.length).trim().toLowerCase();
        return showTodos(
          state.todos.filter((todo) => todo.text.toLowerCase().includes(query)),
          ctx,
        );
      }

      if (subcommand === "complete") {
        if (parts[1]?.toLowerCase() === "all") {
          const ids = state.todos.filter((t) => !t.done).map((t) => t.id);
          if (ids.length === 0) {
            if (ctx.hasUI) notify(ctx, "No open todos to complete", "info");
            return;
          }
          const result = applyTodoCommand(state, { type: "complete", ids });
          state = result.state;
          updateUI(ctx);
          if (result.changed) {
            appendSessionEntry(pi, ctx.sessionManager, TODOS_TYPE, {
              todos: state.todos,
              nextId: state.nextId,
              updatedAt: Date.now(),
            });
          }
          publishState(ctx);
          if (ctx.hasUI) notify(ctx, formatTodoList(state.todos), "info");
          return;
        }

        const idStr = parts[1];
        const id = Number(idStr);
        if (!idStr || !Number.isSafeInteger(id) || id < 1) {
          if (ctx.hasUI) notify(ctx, "Invalid ID", "error");
          return;
        }

        const result = applyTodoCommand(state, { type: "complete", ids: [id] });
        state = result.state;
        updateUI(ctx);
        if (result.changed) {
          appendSessionEntry(pi, ctx.sessionManager, TODOS_TYPE, {
            todos: state.todos,
            nextId: state.nextId,
            updatedAt: Date.now(),
          });
        }
        publishState(ctx);
        if (ctx.hasUI) notify(ctx, formatTodoList(state.todos), "info");
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
          if (ctx.hasUI) notify(ctx, "Usage: /todos edit <id> <text>", "error");
          return;
        }

        const exists = state.todos.some((t) => t.id === id);
        if (!exists) {
          if (ctx.hasUI) notify(ctx, `Unknown ID: ${id}`, "error");
          return;
        }

        state = {
          todos: state.todos.map((t) =>
            t.id === id ? { ...t, text: newText } : t,
          ),
          nextId: state.nextId,
        };
        updateUI(ctx);
        appendSessionEntry(pi, ctx.sessionManager, TODOS_TYPE, {
          todos: state.todos,
          nextId: state.nextId,
          updatedAt: Date.now(),
        });
        publishState(ctx);
        if (ctx.hasUI) notify(ctx, formatTodoList(state.todos), "info");
        return;
      }

      if (subcommand === "delete") {
        if (parts.length === 1) {
          // Clear completed todos
          const hasCompleted = state.todos.some((todo) => todo.done);
          if (!hasCompleted) {
            if (ctx.hasUI) {
              notify(ctx, "No completed todos to delete", "info");
            }
            return;
          }
          state = {
            todos: state.todos.filter((todo) => !todo.done),
            nextId: state.nextId,
          };
          updateUI(ctx);
          appendSessionEntry(pi, ctx.sessionManager, TODOS_TYPE, {
            todos: state.todos,
            nextId: state.nextId,
            updatedAt: Date.now(),
          });
          publishState(ctx);
          if (ctx.hasUI) notify(ctx, formatTodoList(state.todos), "info");
          return;
        }

        const idStr = parts[1];
        const id = Number(idStr);
        if (!idStr || !Number.isSafeInteger(id) || id < 1) {
          if (ctx.hasUI) notify(ctx, "Invalid ID", "error");
          return;
        }

        const exists = state.todos.some((todo) => todo.id === id);
        if (!exists) {
          if (ctx.hasUI) notify(ctx, `Unknown ID: ${id}`, "error");
          return;
        }

        state = {
          todos: state.todos.filter((todo) => todo.id !== id),
          nextId: state.nextId,
        };
        updateUI(ctx);
        appendSessionEntry(pi, ctx.sessionManager, TODOS_TYPE, {
          todos: state.todos,
          nextId: state.nextId,
          updatedAt: Date.now(),
        });
        publishState(ctx);
        if (ctx.hasUI) notify(ctx, formatTodoList(state.todos), "info");
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
            notify(
              ctx,
              "Usage: /todos priority <id> <high|medium|low>",
              "error",
            );
          }
          return;
        }

        const exists = state.todos.some((t) => t.id === id);
        if (!exists) {
          if (ctx.hasUI) notify(ctx, `Unknown ID: ${id}`, "error");
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
        appendSessionEntry(pi, ctx.sessionManager, TODOS_TYPE, {
          todos: state.todos,
          nextId: state.nextId,
          updatedAt: Date.now(),
        });
        publishState(ctx);
        if (ctx.hasUI) notify(ctx, formatTodoList(state.todos), "info");
        return;
      }

      if (ctx.hasUI) {
        notify(
          ctx,
          "Usage: /todos [search <query> | complete <id|all> | edit <id> <text> | delete [id] | priority <id> <high|medium|low>]",
          "info",
        );
      }
    },
  };
  pi.registerCommand("todos", todoCommand);

  pi.registerCommand("widget", {
    description:
      "Toggle sticky widgets: /widget toggle [todos|tasks|subagents|all]",
    getArgumentCompletions: (prefix: string) => {
      const parts = prefix.trimStart().split(/\s+/);
      if (parts.length <= 1) {
        return prefixCompletions(parts[0] ?? "", ["toggle"]);
      }
      if (parts[0]?.toLowerCase() !== "toggle" || parts.length > 2) return null;
      return prefixCompletions(parts[1] ?? "", WIDGET_TARGETS).map(
        ({ value, label }) => ({ value: `toggle ${value}`, label }),
      );
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts[0] !== "toggle") {
        if (ctx.hasUI) {
          notify(
            ctx,
            "Usage: /widget toggle [todos|tasks|subagents|all]",
            "info",
          );
        }
        return;
      }
      const target = parts[1];
      if (
        target !== undefined &&
        !WIDGET_TARGETS.some((value) => value === target)
      ) {
        if (ctx.hasUI) {
          notify(
            ctx,
            `Unsupported widget target: ${sanitizeTerminalText(target)}. Use todos, tasks, subagents, or all.`,
            "error",
          );
        }
        return;
      }
      const collapsed = toggleRegisteredWidgets(
        target as (typeof WIDGET_TARGETS)[number] | undefined,
      );
      if (ctx.hasUI) {
        updateUI(ctx);
        const subject =
          target === undefined || target === "all"
            ? "Widget"
            : `${target[0]?.toUpperCase()}${target.slice(1)} widget`;
        notify(
          ctx,
          collapsed ? `${subject} collapsed` : `${subject} expanded`,
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
      "Todos are managed with the codemode-only `todo` tool (tools.todo). " +
      "Actions: create, complete, delete, edit, priority, list. " +
      "Call it as tools.todo({...}) inside a codemode script, never as a direct top-level tool. " +
      "State is branch-local. Use /todos to view progress.";
  });
}
