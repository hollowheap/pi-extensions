import { describe, expect, it, vi } from "vitest";
import { askSingleQuestion } from "../src/index.js";

vi.mock("@hollowheap/core/alerts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hollowheap/core/alerts")>()),
  deliverAlert: vi.fn().mockResolvedValue("native"),
}));
vi.mock("@hollowheap/core/prompt-lock", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, withPromptLock: vi.fn((fn: () => unknown) => fn()) };
});

interface CustomComponent {
  render: (width: number) => string[];
  handleInput: (data: string) => void;
}

function customDialog() {
  let component: CustomComponent | undefined;
  let done = vi.fn((_value: unknown) => {});
  const custom = vi.fn(
    (
      factory: (
        tui: unknown,
        theme: unknown,
        keys: unknown,
        finish: (value: unknown) => void,
      ) => CustomComponent,
    ) =>
      new Promise<unknown>((resolve) => {
        done = vi.fn((value: unknown) => resolve(value));
        component = factory(
          { requestRender: vi.fn() },
          {
            fg: () => (value: string) => value,
            bold: () => (value: string) => value,
          },
          {},
          done,
        );
      }),
  );
  return { custom, component: () => component };
}

function context(custom: ReturnType<typeof vi.fn>) {
  return {
    hasUI: true,
    mode: "tui",
    ui: { select: vi.fn(), input: vi.fn(), custom },
  };
}

describe("TUI multi-select uses a custom checkbox dialog", () => {
  it("renders checkbox rows with write-in and Done, toggles with space, submits with Enter", async () => {
    const env = customDialog();
    const ctx = context(env.custom);
    const pending = askSingleQuestion(
      { prompt: "Pick many", mode: "multi", options: ["A", "B"], page: 1 },
      ctx as never,
    );

    await vi.waitFor(() => expect(env.component()).toBeDefined());
    const component = env.component();
    if (!component) throw new Error("component is undefined");
    const rendered = component.render(60).join("\n");
    expect(rendered).toContain("[ ] A");
    expect(rendered).toContain("Write-in answer");
    expect(rendered).toContain("Done");

    component.handleInput(" ");
    component.handleInput("\x1b[B");
    component.handleInput("\x1b[B");
    component.handleInput("\x1b[B");
    component.handleInput("\r");

    await expect(pending).resolves.toEqual({
      mode: "multi",
      selected: ["A"],
      writeIn: undefined,
    });
  });

  it("allows submitting with zero selections", async () => {
    const env = customDialog();
    const ctx = context(env.custom);
    const pending = askSingleQuestion(
      { prompt: "Pick many", mode: "multi", options: ["A", "B"], page: 1 },
      ctx as never,
    );

    await vi.waitFor(() => expect(env.component()).toBeDefined());
    const component = env.component();
    if (!component) throw new Error("component is undefined");
    component.handleInput("\x1b[B");
    component.handleInput("\x1b[B");
    component.handleInput("\x1b[B");
    component.handleInput("\r");

    await expect(pending).resolves.toEqual({
      mode: "multi",
      selected: [],
      writeIn: undefined,
    });
  });
});

describe("cancel, write-in, and cleanup seams", () => {
  it("Escape cancels the multi-select dialog", async () => {
    const env = customDialog();
    const pending = askSingleQuestion(
      { prompt: "Pick many", mode: "multi", options: ["A", "B"], page: 1 },
      context(env.custom) as never,
    );
    await vi.waitFor(() => expect(env.component()).toBeDefined());
    env.component()?.handleInput("\x1b");
    await expect(pending).resolves.toBeUndefined();
  });

  it("the write-in row edits and submits custom text", async () => {
    const env = customDialog();
    const pending = askSingleQuestion(
      { prompt: "Pick many", mode: "multi", options: ["A", "B"], page: 1 },
      context(env.custom) as never,
    );
    await vi.waitFor(() => expect(env.component()).toBeDefined());
    const component = env.component();
    if (!component) throw new Error("component is undefined");
    component.handleInput("\x1b[B");
    component.handleInput("\x1b[B");
    component.handleInput(" ");
    component.handleInput("custom");
    component.handleInput("\r");
    component.handleInput("\r");
    await expect(pending).resolves.toEqual({
      mode: "multi",
      selected: [],
      writeIn: "custom",
    });
  });

  it("disposing the dialog cancels the pending question", async () => {
    const env = customDialog();
    const pending = askSingleQuestion(
      { prompt: "Pick many", mode: "multi", options: ["A"], page: 1 },
      context(env.custom) as never,
    );
    await vi.waitFor(() => expect(env.component()).toBeDefined());
    const component = env.component() as CustomComponent & {
      dispose: () => void;
    };
    component.dispose();
    await expect(pending).resolves.toBeUndefined();
  });
});
