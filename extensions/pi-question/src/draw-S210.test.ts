import { describe, expect, it, vi } from "vitest";
import { askQuestion } from "./index.js";

const theme = {
  fg: (_color: unknown, text: string) => text,
  bold: (text: string) => text,
} as never;

type Component = {
  render: (width: number) => string[];
  handleInput: (data: string) => void;
};
type Factory = (
  tui: unknown,
  theme: unknown,
  keybindings: unknown,
  done: (value: unknown) => void,
) => Component;

function freeOverlay(draft: string, act: (component: Component) => void) {
  const getEditorText = vi.fn(() => draft);
  const setEditorText = vi.fn();
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      getEditorText,
      setEditorText,
      custom: vi.fn(
        (factory: Factory) =>
          new Promise((resolve) => {
            const component = factory(
              { requestRender: vi.fn() },
              theme,
              {},
              resolve as (value: unknown) => void,
            );
            act(component);
          }),
      ),
    },
  };
  return { ctx, getEditorText, setEditorText };
}

const freeQuestion = {
  prompt: "Say something",
  mode: "free",
  options: [],
} as never;

describe("text overlay prompt surface", () => {
  it("S210 C01: stashes the prompt draft on open and restores it on close", async () => {
    const draft = "half typed draft";
    const getEditorText = vi.fn(() => draft);
    const setEditorText = vi.fn();
    let done = vi.fn();
    let component: Component | undefined;
    let finish = (_value: unknown) => {};
    const ctx = {
      mode: "tui",
      hasUI: true,
      ui: {
        getEditorText,
        setEditorText,
        custom: vi.fn(
          (factory: Factory) =>
            new Promise((resolve) => {
              finish = resolve;
              done = vi.fn((value: unknown) => finish(value));
              component = factory({ requestRender: vi.fn() }, theme, {}, done);
              component?.handleInput("\x1b");
            }),
        ),
      },
    };

    await askQuestion(
      { prompt: "Say something", mode: "free", options: [] },
      ctx as never,
    );

    expect(getEditorText).toHaveBeenCalled();
    expect(setEditorText).toHaveBeenCalledWith(draft);
  });

  it("S210 C02: an empty draft is still restored on close", async () => {
    const { ctx, setEditorText } = freeOverlay("", (component) =>
      component.handleInput("\x1b"),
    );
    await askQuestion(freeQuestion, ctx as never);
    expect(setEditorText).toHaveBeenCalledWith("");
  });

  it("S210 C03: cancelling returns undefined and restores the draft", async () => {
    const draft = "half typed draft";
    const { ctx, setEditorText } = freeOverlay(draft, (component) =>
      component.handleInput("\x1b"),
    );
    const answer = await askQuestion(freeQuestion, ctx as never);
    expect(answer).toBeUndefined();
    expect(setEditorText).toHaveBeenCalledWith(draft);
  });

  it("S210 C04: a confirmed answer reaches the caller and restores the draft", async () => {
    const draft = "half typed draft";
    const { ctx, setEditorText } = freeOverlay(draft, (component) => {
      for (const char of "hello") component.handleInput(char);
      component.handleInput("\r");
    });
    const answer = await askQuestion(freeQuestion, ctx as never);
    expect(answer).toEqual({ mode: "free", value: "hello" });
    expect(setEditorText).toHaveBeenCalledWith(draft);
  });
});
