import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "./config.js";
import { showStatuslineSettings } from "./settings.js";

const theme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
};

function settingsContext() {
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
            done: () => void,
          ) => {
            render(width: number): string[];
            handleInput(data: string): void;
          },
        ) =>
          new Promise<void>((resolve) => {
            component = factory({ requestRender: vi.fn() }, theme, {}, resolve);
          }),
      ),
    },
  };
  return { ctx, component: () => component };
}

describe("showStatuslineSettings", () => {
  it("cycles settings and reports the updated config", async () => {
    const env = settingsContext();
    const config = defaultConfig();
    const onChange = vi.fn();
    const result = showStatuslineSettings(env.ctx as never, config, onChange);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    const rendered = env.component()?.render(80).join("\n") ?? "";
    expect(rendered).toContain("Statusline settings");
    expect(rendered).toContain("Component separator");
    env.component()?.handleInput("\r");

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as ReturnType<
      typeof defaultConfig
    >;
    expect(next.options.componentSeparator.text).toBe(" | ");
    expect(config.options.componentSeparator.text).toBe(" ");

    env.component()?.handleInput("\x1b");
    await result;
  });
});
