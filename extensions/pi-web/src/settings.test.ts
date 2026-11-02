import { describe, expect, it, vi } from "vitest";
import { showWebSettings } from "./settings.js";

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

function emptyConfig() {
  return { path: "/tmp/web.json", diagnostics: [] };
}

describe("showWebSettings", () => {
  it("cycles the search preference and saves it", async () => {
    const env = settingsContext();
    const onSave = vi.fn();
    const result = showWebSettings(env.ctx as never, emptyConfig(), onSave);
    await vi.waitFor(() => expect(env.component()).toBeDefined());

    expect(env.component()?.render(80).join("\n")).toContain(
      "Search preference",
    );
    env.component()?.handleInput("\r");

    expect(onSave).toHaveBeenCalledWith({
      searchOrder: ["exa", "tavily", "firecrawl"],
      fetchOrder: undefined,
    });

    env.component()?.handleInput("\x1b");
    await result;
  });

  it("returns without opening outside TUI mode", async () => {
    const custom = vi.fn();
    await showWebSettings(
      { mode: "rpc", hasUI: true, ui: { custom } } as never,
      emptyConfig(),
      vi.fn(),
    );
    expect(custom).not.toHaveBeenCalled();
  });
});
