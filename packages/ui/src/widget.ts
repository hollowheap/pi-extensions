import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  MouseRegion,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { boxFrame } from "./frame.js";

export type WidgetTodoPriority = "high" | "medium" | "low";

export interface WidgetTodo {
  id: number;
  text: string;
  done: boolean;
  priority?: WidgetTodoPriority;
}

export interface WidgetSubagentStateItem {
  id: string;
  label?: string;
  agent?: string;
  task?: string;
  state: "running" | "blocked" | "complete" | string;
  startedAt?: number;
  activeTool?: string;
  activeToolStartedAt?: number;
}

export interface WidgetTaskStateItem {
  id: string;
  command?: string;
  status: "running" | string;
}

export interface WidgetFormatOptions {
  strikethrough?: (text: string) => string;
  borderColor?: (text: string) => string;
  width?: number;
  now?: number;
  collapsed?: boolean;
}

const WIDGET_LIMIT = 10;
const PRIORITY_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function fitWidth(lines: string[], width: number | undefined): string[] {
  if (width === undefined || width <= 0) return lines;
  return lines.map((line) =>
    visibleWidth(line) > width ? truncateToWidth(line, width, "") : line,
  );
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

export function formatSubagentWidget(
  subagents: readonly WidgetSubagentStateItem[],
  options: WidgetFormatOptions = {},
): string[] | undefined {
  if (options.collapsed || subagents.length === 0) return undefined;
  const now = options.now ?? Date.now();
  const lines = [`Subagents (${subagents.length} active)`];
  for (const sub of subagents) {
    const handle = sanitizeTerminalText(sub.label ?? `@${sub.id}`);
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
        `${handle} ${formatElapsed(now - sub.startedAt)}${taskPart} ${stateIcon(sub.state)}${toolPart}`,
      );
    } else {
      const agent = sub.agent ? ` (${sanitizeTerminalText(sub.agent)})` : "";
      lines.push(`${handle} ${stateIcon(sub.state)}${agent}`);
    }
  }
  return fitWidth(lines, options.width);
}

export function formatTaskWidget(
  tasks: readonly WidgetTaskStateItem[],
  options: WidgetFormatOptions = {},
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
  todos: readonly WidgetTodo[],
  _subagents: readonly WidgetSubagentStateItem[] = [],
  _tasks: readonly WidgetTaskStateItem[] = [],
  options: WidgetFormatOptions = {},
): string[] | undefined {
  if (options.collapsed || todos.length === 0) return undefined;

  const sorted = [...todos].sort((left, right) => {
    const leftPriority = PRIORITY_ORDER[left.priority ?? "medium"] ?? 1;
    const rightPriority = PRIORITY_ORDER[right.priority ?? "medium"] ?? 1;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.id - right.id;
  });
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

export type WidgetPlacement = "aboveEditor" | "belowEditor";

export interface WidgetProvider {
  name: string;
  label: string;
  render(width: number, theme?: Theme): readonly string[] | undefined;
  placement?: WidgetPlacement;
  hint?: string;
}

export type WidgetFactory = (
  tui?: TUI,
  theme?: Theme,
) => Component & { dispose?(): void };

export interface WidgetMountContext {
  hasUI?: boolean;
  ui: {
    setWidget(
      key: string,
      content: string[] | WidgetFactory | undefined,
      options?: { placement?: WidgetPlacement },
    ): void;
    theme?: Theme;
  };
}

interface WidgetState {
  providers: Map<string, WidgetProvider>;
  visible: Map<string, boolean>;
}

const WIDGET_STATE_KEY = Symbol.for("@hollowheap/ui/widgets");

function widgetState(): WidgetState {
  const store = globalThis as Record<symbol, WidgetState | undefined>;
  const existing = store[WIDGET_STATE_KEY];
  if (existing !== undefined) return existing;
  const created: WidgetState = {
    providers: new Map(),
    visible: new Map(),
  };
  store[WIDGET_STATE_KEY] = created;
  return created;
}

/** Register a named widget provider. Returns a disposer that removes it. */
export function registerWidgetProvider(provider: WidgetProvider): () => void {
  const state = widgetState();
  state.providers.set(provider.name, provider);
  state.visible.delete(provider.name);
  return () => {
    if (state.providers.get(provider.name) === provider) {
      state.providers.delete(provider.name);
      state.visible.delete(provider.name);
    }
  };
}

export function getWidgetProvider(name: string): WidgetProvider | undefined {
  return widgetState().providers.get(name);
}

export function listWidgetProviders(): string[] {
  return [...widgetState().providers.keys()];
}

export function isWidgetVisible(name: string): boolean {
  return widgetState().visible.get(name) !== false;
}

export function setWidgetVisible(name: string, visible: boolean): void {
  widgetState().visible.set(name, visible);
}

const WIDGET_CHORDS = Object.freeze({
  todos: "t",
  tasks: "b",
  subagents: "s",
});

export function widgetChordTarget(key: string): string | null {
  const entry = Object.entries(WIDGET_CHORDS).find(
    ([, chord]) => chord === key,
  );
  return entry?.[0] ?? null;
}

export function widgetToggleHint(name?: string): string {
  const chord =
    name !== undefined && Object.hasOwn(WIDGET_CHORDS, name)
      ? WIDGET_CHORDS[name as keyof typeof WIDGET_CHORDS]
      : "p";
  const prefix = process.platform === "darwin" ? "Option+W" : "Alt+W";
  return `${prefix} then ${chord.toUpperCase()}`;
}

/** Toggle one widget or every registered widget. Returns true when collapsed. */
export function toggleWidgets(target?: string | readonly string[]): boolean {
  const names =
    target === undefined || target === "all"
      ? listWidgetProviders()
      : typeof target === "string"
        ? [target]
        : target;
  const collapse = names.some((name) => isWidgetVisible(name));
  for (const name of names) setWidgetVisible(name, !collapse);
  return collapse;
}

function setHostWidget(
  ui: WidgetMountContext["ui"],
  name: string,
  content: string[] | WidgetFactory | undefined,
  placement?: WidgetPlacement,
): void {
  if (placement === undefined) ui.setWidget(name, content);
  else ui.setWidget(name, content, { placement });
}

function clickWidget(
  name: string,
): (event: TuiMouseEvent) => TuiMouseEventResult | undefined {
  return (event) => {
    if (event.type !== "click" || event.button !== "left") return undefined;
    toggleWidgets(name);
    return { handled: true };
  };
}

function createWidget(
  provider: WidgetProvider,
  fallbackTheme: Theme | undefined,
  ui: WidgetMountContext["ui"],
): WidgetFactory {
  return (_tui, factoryTheme) => {
    const theme = factoryTheme ?? fallbackTheme ?? ({} as Theme);
    const component: Component = {
      render(width: number) {
        const lines = provider.render(width, theme);
        if (lines === undefined || lines.length === 0) return [];
        const hint = provider.hint ?? widgetToggleHint(provider.name);
        return boxFrame(
          lines,
          width,
          theme,
          `${provider.label} · ${hint} to hide`,
        );
      },
      invalidate() {},
    };
    return new MouseRegion(component, (event) => {
      const result = clickWidget(provider.name)(event);
      if (result !== undefined) {
        setHostWidget(ui, provider.name, undefined, provider.placement);
      }
      return result;
    });
  };
}

function mountWidget(ctx: WidgetMountContext, provider: WidgetProvider): void {
  const theme = ctx.ui.theme;
  if (!isWidgetVisible(provider.name)) {
    setHostWidget(ctx.ui, provider.name, undefined, provider.placement);
    return;
  }
  const initial = provider.render(0, theme);
  if (initial === undefined || initial.length === 0) {
    setHostWidget(ctx.ui, provider.name, undefined, provider.placement);
    return;
  }
  setHostWidget(
    ctx.ui,
    provider.name,
    createWidget(provider, theme, ctx.ui),
    provider.placement,
  );
}

/** Mount every registered widget into the host UI. */
export function mountWidgetProviders(ctx: WidgetMountContext): void {
  if (!ctx.hasUI || typeof ctx.ui?.setWidget !== "function") return;
  for (const provider of widgetState().providers.values()) {
    mountWidget(ctx, provider);
  }
}
