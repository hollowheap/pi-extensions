import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_TUI_CONFIG } from "@hollowheap/core/tui-config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetActiveTuiConfig, setActiveTuiConfig } from "./state.js";
import { showCodeViewer } from "./viewer.js";

afterEach(() => {
  resetActiveTuiConfig();
});

describe("showCodeViewer", () => {
  it("applies accent and border colors without breaking frame width", async () => {
    type FactoryFn = (
      tui: unknown,
      theme: unknown,
      keybindings: unknown,
      done: () => void,
    ) => { render: (width: number) => string[] };
    let factory: FactoryFn | undefined;

    const ctx = {
      hasUI: true,
      mode: "tui",
      ui: {
        custom: vi.fn((value: FactoryFn) => {
          factory = value;
          return Promise.resolve();
        }),
      },
    } as unknown as ExtensionContext;

    await showCodeViewer(ctx, "Last codemode script", "const answer = 42;");
    if (!factory) throw new Error("viewer factory was not captured");

    const theme = {
      fg: (token: string, value: string) =>
        `\x1b[${token === "accent" ? 36 : token === "dim" ? 90 : 34}m${value}\x1b[39m`,
      bold: (value: string) => value,
    };
    const component = factory(
      { terminal: { rows: 30 }, requestRender: vi.fn() },
      theme,
      {},
      vi.fn(),
    );
    const lines = component.render(40);

    expect(lines[0]).toContain("\x1b[36mLast codemode script");
    expect(lines[0]?.startsWith("\x1b[34m╭─")).toBe(true);
    expect(lines.at(-1)?.startsWith("\x1b[34m╰─")).toBe(true);
    expect(lines.join("\n")).toContain("const answer = 42;");
    for (const line of lines) {
      expect(visibleWidth(line)).toBe(40);
    }
  });

  it("guards close, resolves on dispose, and repaints on invalidate", async () => {
    type FactoryFn = (
      tui: unknown,
      theme: unknown,
      keybindings: unknown,
      done: () => void,
    ) => {
      handleInput(data: string): void;
      invalidate(): void;
      dispose(): void;
    };
    let factory: FactoryFn | undefined;
    const ctx = {
      hasUI: true,
      mode: "tui",
      ui: {
        custom: vi.fn((value: FactoryFn) => {
          factory = value;
          return Promise.resolve();
        }),
      },
    } as unknown as ExtensionContext;

    await showCodeViewer(ctx, "Script", "const x = 1;");
    if (!factory) throw new Error("viewer factory was not captured");

    const theme = {
      fg: (_token: string, value: string) => value,
      bold: (value: string) => value,
    };
    const requestRender = vi.fn();
    const done = vi.fn();
    const component = factory(
      { terminal: { rows: 12 }, requestRender },
      theme,
      {},
      done,
    );

    component.invalidate();
    expect(requestRender).toHaveBeenCalled();
    component.handleInput("\x1b");
    component.handleInput("\r");
    expect(done).toHaveBeenCalledTimes(1);

    const done2 = vi.fn();
    const other = factory(
      { terminal: { rows: 12 }, requestRender: vi.fn() },
      theme,
      {},
      done2,
    );
    other.dispose();
    other.dispose();
    expect(done2).toHaveBeenCalledTimes(1);
  });

  it("respects active borderStyle, none border, and overlaySurface", async () => {
    type FactoryFn = (
      tui: unknown,
      theme: unknown,
      keybindings: unknown,
      done: () => void,
    ) => { render: (width: number) => string[] };
    let factory: FactoryFn | undefined;
    const ctx = {
      hasUI: true,
      mode: "tui",
      ui: {
        custom: vi.fn((value: FactoryFn) => {
          factory = value;
          return Promise.resolve();
        }),
      },
    } as unknown as ExtensionContext;

    await showCodeViewer(ctx, "Script", "const x = 1;");
    if (!factory) throw new Error("viewer factory was not captured");

    const theme = {
      fg: (_token: string, value: string) => value,
      bg: (token: string, value: string) => `[${token}]${value}[/]`,
      bold: (value: string) => value,
    };
    const component = factory(
      { terminal: { rows: 12 }, requestRender: vi.fn() },
      theme,
      {},
      vi.fn(),
    );

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      borderStyle: "double",
      overlaySurface: "surface",
    });
    const doubleLines = component.render(32);
    expect(doubleLines[0]).toContain("[customMessageBg]╔═");
    expect(doubleLines.at(-1)).toContain("╚═");

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      borderStyle: "none",
      overlaySurface: "card",
    });
    const noneLines = component.render(32);
    expect(noneLines[0]).toContain("[userMessageBg]Script");
    expect(noneLines[0]).not.toContain("╭");
    expect(noneLines.join("\n")).toContain("const x = 1;");
  });
});
