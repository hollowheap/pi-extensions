import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "./config.js";
import { showDashboardSettings } from "./settings.js";

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

describe("showDashboardSettings", () => {
  it("cycles the header preset and reports the pending settings", async () => {
    const env = settingsContext();
    const onSave = vi.fn();
    const result = showDashboardSettings(
      env.ctx as never,
      defaultConfig(),
      onSave,
    );
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    env.component()?.handleInput("\r");
    expect(onSave).toHaveBeenCalledWith({
      header: "version",
      gap: 0,
    });

    env.component()?.handleInput("\x1b");
    await result;
  });
});
