import { describe, expect, it, vi } from "vitest";
import { showThemePicker } from "./theme-picker.js";

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
      }
    | undefined;
  const setTheme = vi.fn(() => ({ success: true }));
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
    expect(env.setTheme).toHaveBeenLastCalledWith(currentTheme);
  });
});
