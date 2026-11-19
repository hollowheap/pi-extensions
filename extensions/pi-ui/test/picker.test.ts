import { DEFAULT_TUI_CONFIG } from "@hollowheap/core/tui-config";
import {
  resetActiveTuiConfig,
  setActiveTuiConfig,
} from "@hollowheap/tui/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showFuzzyPicker } from "../src/picker.js";

afterEach(() => {
  resetActiveTuiConfig();
});

const theme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
};

function pickerContext() {
  const requestRender = vi.fn();
  let component:
    | {
        render(width: number): string[];
        handleInput(data: string): void;
      }
    | undefined;
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      custom: vi.fn(
        (
          factory: (
            tui: unknown,
            theme: unknown,
            keybindings: unknown,
            done: (value: string | undefined) => void,
          ) => {
            render(width: number): string[];
            handleInput(data: string): void;
          },
        ) =>
          new Promise<string | undefined>((resolve) => {
            component = factory({ requestRender }, theme, {}, resolve);
          }),
      ),
    },
  };
  return { ctx, component: () => component, requestRender };
}

const items = [
  {
    value: "task-a",
    label: "task-a",
    description: "running — sleep 30",
    preview: ["running", "command: sleep 30"],
  },
  {
    value: "task-b",
    label: "task-b",
    description: "completed — echo done",
    preview: ["completed", "command: echo done"],
  },
];

describe("showFuzzyPicker", () => {
  it("fuzzy filters and returns the selected value", async () => {
    const env = pickerContext();
    const result = showFuzzyPicker(env.ctx as never, {
      title: "Select a task",
      items,
    });
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    const component = env.component();
    expect(component?.render(60).join("\n")).toContain("task-a");
    for (const key of "done") component?.handleInput(key);
    expect(component?.render(60).join("\n")).not.toContain("task-a");
    component?.handleInput("\r");

    await expect(result).resolves.toBe("task-b");
  });

  it("reports the initial selected item to the header", async () => {
    const env = pickerContext();
    const header = vi.fn((_query: string, selected?: { label?: string }) => [
      selected?.label ?? "none",
    ]);
    const result = showFuzzyPicker(env.ctx as never, {
      title: "Select a task",
      items,
      initialValue: "task-b",
      header,
    });
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    env.component()?.render(60);
    expect(header).toHaveBeenCalledWith(
      "",
      expect.objectContaining({ value: "task-b" }),
    );

    env.component()?.handleInput("\x1b");
    await expect(result).resolves.toBeUndefined();
  });

  it("returns undefined when cancelled", async () => {
    const env = pickerContext();
    const result = showFuzzyPicker(env.ctx as never, {
      title: "Select a task",
      items,
    });
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    env.component()?.handleInput("\x1b");
    await expect(result).resolves.toBeUndefined();
  });

  it("appends a bracketed paste payload to the filter", async () => {
    const env = pickerContext();
    const result = showFuzzyPicker(env.ctx as never, {
      title: "Select a task",
      items,
    });
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    const component = env.component();
    component?.handleInput("\x1b[200~done\x1b[201~");

    const rendered = component?.render(60).join("\n") ?? "";
    expect(rendered).toContain("Filter: done");
    expect(rendered).not.toContain("task-a");
    component?.handleInput("\r");
    await expect(result).resolves.toBe("task-b");
  });

  it("appends modifyOtherKeys printable input to the filter", async () => {
    const env = pickerContext();
    const result = showFuzzyPicker(env.ctx as never, {
      title: "Select a task",
      items,
    });
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    const component = env.component();
    for (const codepoint of [100, 111, 110, 101]) {
      component?.handleInput(`\x1b[27;1;${codepoint}~`);
    }

    const rendered = component?.render(60).join("\n") ?? "";
    expect(rendered).toContain("Filter: done");
    expect(rendered).not.toContain("task-a");
    component?.handleInput("\r");
    await expect(result).resolves.toBe("task-b");
  });

  it("clears a non-empty filter on Escape before cancelling", async () => {
    const env = pickerContext();
    const result = showFuzzyPicker(env.ctx as never, {
      title: "Select a task",
      items,
    });
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    const component = env.component();
    for (const key of "done") component?.handleInput(key);
    expect(component?.render(60).join("\n")).not.toContain("task-a");

    const settled = vi.fn();
    void result.then(settled);
    component?.handleInput("\x1b");
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    const rendered = component?.render(60).join("\n") ?? "";
    expect(rendered).toContain("Filter: (type to search)");
    expect(rendered).toContain("task-a");

    component?.handleInput("\r");
    await expect(result).resolves.toBe("task-a");
  });

  it("falls back outside the TUI", async () => {
    const result = await showFuzzyPicker(
      { mode: "rpc", hasUI: true, ui: {} } as never,
      { title: "Select a task", items },
    );
    expect(result).toBeUndefined();
  });

  it("rebuilds the select theme on config change and invalidate", async () => {
    const env = pickerContext();
    const result = showFuzzyPicker(env.ctx as never, {
      title: "Select a task",
      items,
    });
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    setActiveTuiConfig({ ...DEFAULT_TUI_CONFIG, colored: false });
    expect(env.requestRender).toHaveBeenCalled();

    env.requestRender.mockClear();
    (env.component() as unknown as { invalidate(): void }).invalidate();
    expect(env.requestRender).toHaveBeenCalled();

    env.component()?.handleInput("\x1b");
    await expect(result).resolves.toBeUndefined();
  });

  it("resolves undefined and releases the prompt lock when disposed without calling done", async () => {
    const env = pickerContext();
    const first = showFuzzyPicker(env.ctx as never, {
      title: "Select a task",
      items,
    });
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    (env.component() as unknown as { dispose?: () => void })?.dispose?.();
    await expect(first).resolves.toBeUndefined();

    const env2 = pickerContext();
    const second = showFuzzyPicker(env2.ctx as never, {
      title: "Select a task",
      items,
    });
    await vi.waitFor(() => expect(env2.component()).toBeDefined());
    env2.component()?.handleInput("\x1b");
    await expect(second).resolves.toBeUndefined();
  });
});
