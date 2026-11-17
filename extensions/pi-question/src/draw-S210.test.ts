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
});
