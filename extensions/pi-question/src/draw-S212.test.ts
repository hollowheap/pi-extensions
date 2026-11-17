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

describe("question mode flow", () => {
  it("S212 C01: Escape from a free-text answer returns to the choice list", async () => {
    let component: Component | undefined;
    let done = vi.fn();
    const ctx = {
      mode: "tui",
      hasUI: true,
      ui: {
        custom: vi.fn(
          (factory: Factory) =>
            new Promise((resolve) => {
              done = vi.fn(resolve);
              component = factory({ requestRender: vi.fn() }, theme, {}, done);
            }),
        ),
      },
    };

    void askQuestion(
      { prompt: "Pick", mode: "multi", options: ["A", "B"] },
      ctx as never,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(component).toBeDefined();

    component?.handleInput("\x1b[B");
    component?.handleInput("\x1b[B");
    component?.handleInput(" ");
    component?.handleInput("draft");
    component?.handleInput("\x1b");

    expect(done).not.toHaveBeenCalled();
  });
});
