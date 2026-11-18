import { afterEach, describe, expect, it, vi } from "vitest";
import { askQuestion } from "./index.js";

afterEach(() => {
  const globals = globalThis as unknown as Record<
    symbol,
    { state: { locked: boolean; queue: unknown[] } } | undefined
  >;
  const lock = globals[Symbol.for("@hollowheap/core/prompt-lock")];
  if (lock !== undefined) lock.state = { locked: false, queue: [] };
});

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

function multiDialog() {
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
  const pending = askQuestion(
    { prompt: "Pick", mode: "multi", options: ["A", "B"] },
    ctx as never,
  );
  return {
    ctx,
    done: () => done,
    component: () => component,
    pending,
  };
}

const settle = async (dialog: ReturnType<typeof multiDialog>) => {
  await vi.waitFor(() => expect(dialog.component()).toBeDefined());
};

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

  it("S212 C02: toggling an option marks it in the rendered list", async () => {
    const dialog = multiDialog();
    await settle(dialog);
    dialog.component()?.handleInput(" ");
    expect(dialog.component()?.render(80).join("\n")).toContain("[x] A");
    dialog.component()?.handleInput("\x1b");
    await dialog.pending;
  });

  it("S212 C03: Escape from the choice list cancels the dialog", async () => {
    const dialog = multiDialog();
    await settle(dialog);
    dialog.component()?.handleInput("\x1b");
    await expect(dialog.pending).resolves.toBeUndefined();
    expect(dialog.done()).toHaveBeenCalled();
  });

  it("S212 C04: confirming Done returns the selected answer", async () => {
    const dialog = multiDialog();
    await settle(dialog);
    dialog.component()?.handleInput(" ");
    dialog.component()?.handleInput("\x1b[B");
    dialog.component()?.handleInput("\x1b[B");
    dialog.component()?.handleInput("\x1b[B");
    dialog.component()?.handleInput("\r");
    const answer = await dialog.pending;
    expect(answer).toMatchObject({ mode: "multi", selected: [0] });
  });
});
