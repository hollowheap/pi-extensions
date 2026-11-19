import { withPromptLock } from "@hollowheap/core/prompt-lock";
import { describe, expect, it, vi } from "vitest";
import { showThemePicker } from "../src/theme-picker.js";

vi.mock("@hollowheap/core/prompt-lock", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@hollowheap/core/prompt-lock")>();
  return { ...actual, withPromptLock: vi.fn(actual.withPromptLock) };
});

const theme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
};

const currentTheme = { name: "dark" };

function pickerContext() {
  let component:
    | {
        render(width: number): string[];
        handleInput(data: string): void;
        handleMouse?(event: unknown): unknown;
        dispose?(): void;
      }
    | undefined;
  const setTheme = vi.fn((_theme: string) => ({ success: true }));
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      theme: currentTheme,
      getAllThemes: () => [
        { name: "dark", path: "/themes/dark.json" },
        { name: "light", path: undefined },
      ],
      setTheme,
      notify: vi.fn(),
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
            handleMouse?(event: unknown): unknown;
            dispose?(): void;
          },
        ) =>
          new Promise<string | undefined>((resolve) => {
            component = factory({ requestRender: vi.fn() }, theme, {}, resolve);
          }),
      ),
    },
  };
  return { ctx, setTheme, component: () => component };
}

describe("showThemePicker", () => {
  it("previews and selects a theme", async () => {
    const env = pickerContext();
    const result = showThemePicker(env.ctx as never);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    env.component()?.handleInput("\x1b[B");
    expect(env.setTheme).toHaveBeenLastCalledWith("light");
    env.component()?.handleInput("\r");

    await expect(result).resolves.toBe("light");
  });

  it("restores the original theme on cancel", async () => {
    const env = pickerContext();
    const result = showThemePicker(env.ctx as never);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    env.component()?.handleInput("\x1b[B");
    env.component()?.handleInput("\x1b");
    await expect(result).resolves.toBeUndefined();
    expect(env.setTheme).toHaveBeenLastCalledWith(currentTheme.name);
    expect(typeof env.setTheme.mock.calls.at(-1)?.[0]).toBe("string");
  });

  it("acquires the prompt lock while the picker is open", async () => {
    const env = pickerContext();
    const result = showThemePicker(env.ctx as never);
    await vi.waitFor(() => expect(env.component()).toBeDefined());
    expect(withPromptLock).toHaveBeenCalled();
    env.component()?.handleInput("\x1b");
    await result;
  });

  it("commits the last successfully previewed theme", async () => {
    const env = pickerContext();
    env.setTheme.mockImplementation((name: string) =>
      name === "light"
        ? { success: false, error: "missing theme" }
        : { success: true },
    );
    const result = showThemePicker(env.ctx as never);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    env.component()?.handleInput("\x1b[B");
    expect(env.ctx.ui.notify).toHaveBeenCalled();
    env.component()?.handleInput("\r");

    await expect(result).resolves.toBe("dark");
  });

  it("translates mouse coordinates to the list inside the frame", async () => {
    const env = pickerContext();
    const result = showThemePicker(env.ctx as never);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    const event = (type: "press" | "click") => ({
      type,
      button: "left",
      x: 6,
      y: 4,
      screenX: 6,
      screenY: 4,
      width: 80,
      height: 20,
      shift: false,
      alt: false,
      ctrl: false,
    });
    env.component()?.handleMouse?.(event("press"));
    env.component()?.handleMouse?.(event("click"));

    expect(env.setTheme).toHaveBeenLastCalledWith("light");
    await expect(result).resolves.toBe("light");
  });

  it("returns undefined outside TUI without touching theme APIs", async () => {
    const ctx = { mode: "rpc", hasUI: true, ui: {} } as never;
    await expect(showThemePicker(ctx)).resolves.toBeUndefined();
  });

  it("settles on host teardown and restores the original theme once", async () => {
    const env = pickerContext();
    const result = showThemePicker(env.ctx as never);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    env.component()?.handleInput("\x1b[B");
    env.component()?.dispose?.();
    await expect(result).resolves.toBeUndefined();
    expect(env.setTheme).toHaveBeenLastCalledWith(currentTheme.name);

    const calls = env.setTheme.mock.calls.length;
    env.component()?.dispose?.();
    expect(env.setTheme).toHaveBeenCalledTimes(calls);
  });
});
