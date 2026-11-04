import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { showCodeViewer } from "./viewer.js";

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
});
