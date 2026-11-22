import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTOCOMPLETE_WIDGET_KEY,
  formatSubagentWidget,
  formatTaskWidget,
  formatTodoWidget,
  getVisibleWidgetHeight,
  getWidgetProvider,
  isWidgetVisible,
  listWidgetProviders,
  mountWidgetProviders,
  registerWidgetProvider,
  setAutocompleteWidget,
  setWidgetVisible,
  toggleWidgets,
} from "../src/widget.js";

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function register(name: string) {
  const dispose = registerWidgetProvider({
    name,
    label: name,
    render: () => [name.toUpperCase()],
  });
  disposers.push(dispose);
  return dispose;
}

describe("autocomplete widget ordering", () => {
  it("stays last after widget polling re-registers a provider", () => {
    const calls: string[] = [];
    const ui = {
      setWidget: (name: string, _content: unknown, _options?: unknown) => {
        calls.push(name);
      },
      theme: { fg: (_t: string, value: string) => value },
    } as never;
    setAutocompleteWidget(ui, ["suggestion"], "aboveEditor");
    const dispose = registerWidgetProvider({
      name: "tui-test-poll",
      label: "Poll",
      render: () => ["poll"],
    });
    mountWidgetProviders({ hasUI: true, ui } as never);
    dispose();

    expect(calls.at(-1)).toBe(AUTOCOMPLETE_WIDGET_KEY);
    setAutocompleteWidget(ui, undefined);
  });
});

describe("widget provider registry", () => {
  it("registers, replaces, and disposes providers by name", () => {
    const first = register("tui-test-widget");
    expect(getWidgetProvider("tui-test-widget")?.render(0)).toEqual([
      "TUI-TEST-WIDGET",
    ]);

    const replacement = register("tui-test-widget");
    expect(listWidgetProviders()).toContain("tui-test-widget");
    expect(getWidgetProvider("tui-test-widget")?.render(0)).toEqual([
      "TUI-TEST-WIDGET",
    ]);

    replacement();
    expect(getWidgetProvider("tui-test-widget")).toBeUndefined();

    first();
    expect(getWidgetProvider("tui-test-widget")).toBeUndefined();
  });

  it("tracks visibility per widget and toggles named or all widgets", () => {
    register("tui-test-one");
    register("tui-test-two");

    expect(isWidgetVisible("tui-test-one")).toBe(true);
    expect(toggleWidgets("tui-test-one")).toBe(true);
    expect(isWidgetVisible("tui-test-one")).toBe(false);
    expect(isWidgetVisible("tui-test-two")).toBe(true);
    expect(toggleWidgets(["tui-test-one"])).toBe(false);
    expect(isWidgetVisible("tui-test-one")).toBe(true);

    setWidgetVisible("tui-test-two", false);
    expect(toggleWidgets()).toBe(true);
    expect(isWidgetVisible("tui-test-one")).toBe(false);
    expect(toggleWidgets()).toBe(false);
    expect(isWidgetVisible("tui-test-one")).toBe(true);
    expect(isWidgetVisible("tui-test-two")).toBe(true);
  });
});

describe("widget mounting", () => {
  it("mounts framed providers and clears hidden or empty providers", () => {
    const dispose = registerWidgetProvider({
      name: "tui-test-mount",
      label: "Mount",
      render: (width) => (width === -1 ? undefined : ["one", "two"]),
    });
    disposers.push(dispose);
    const emptyDispose = registerWidgetProvider({
      name: "tui-test-empty",
      label: "Empty",
      render: () => undefined,
    });
    disposers.push(emptyDispose);
    const setWidget = vi.fn();
    const ctx = {
      hasUI: true,
      ui: { setWidget, theme: {} as Theme },
    };

    mountWidgetProviders(ctx);

    expect(setWidget).toHaveBeenCalledWith("tui-test-empty", undefined);
    const factory = setWidget.mock.calls.find(
      ([name]) => name === "tui-test-mount",
    )?.[1];
    expect(typeof factory).toBe("function");
    const rows = (
      factory as () => { render(width: number): string[] }
    )().render(20);
    expect(rows[0]).toContain("Mount");
    expect(rows.at(-1)).toContain("╯");
    expect(getVisibleWidgetHeight()).toBe(rows.length);
    setWidgetVisible("tui-test-mount", false);
    expect(getVisibleWidgetHeight()).toBe(0);
  });

  it("clicking a mounted widget hides it", () => {
    register("tui-test-click");
    const setWidget = vi.fn();
    const ctx = {
      hasUI: true,
      ui: { setWidget, theme: {} as Theme },
    };
    mountWidgetProviders(ctx);
    const factory = setWidget.mock.calls.find(
      ([name]) => name === "tui-test-click",
    )?.[1] as () => {
      handleMouse?(event: TuiMouseEvent): { handled?: boolean } | undefined;
    };
    const component = factory();
    const event = {
      type: "click",
      button: "left",
      x: 1,
      y: 1,
      screenX: 1,
      screenY: 1,
      width: 20,
      height: 1,
      shift: false,
      alt: false,
      ctrl: false,
    } as TuiMouseEvent;

    expect(component.handleMouse?.(event)).toEqual({ handled: true });
    expect(isWidgetVisible("tui-test-click")).toBe(false);
    expect(setWidget).toHaveBeenLastCalledWith("tui-test-click", undefined);
  });
});

describe("shared widget rows", () => {
  it("formats todos, tasks, and subagent lines", () => {
    expect(formatTodoWidget([{ id: 1, text: "ship", done: false }])?.[1]).toBe(
      "• 1 ship",
    );
    expect(
      formatTaskWidget([{ id: "t1", status: "running", command: "npm test" }]),
    ).toEqual(["Tasks (1 running)", "t1 ● (npm test)"]);
    expect(
      formatSubagentWidget([{ id: "s1", state: "running", startedAt: 0 }], {
        now: 1000,
      }),
    ).toEqual(["Subagents (1 active)", "@s1 00:01 ●"]);
    expect(
      formatSubagentWidget(
        [
          {
            id: "s1",
            label: "@scout-1",
            state: "running",
            startedAt: 0,
          },
        ],
        { now: 1000 },
      ),
    ).toEqual(["Subagents (1 active)", "@scout-1 00:01 ●"]);
  });
});
