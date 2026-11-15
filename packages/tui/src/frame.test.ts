import { visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_TUI_CONFIG } from "@hollowheap/core/tui-config";
import { afterEach, describe, expect, it } from "vitest";
import { roundedFrame } from "./frame.js";
import { resetActiveTuiConfig, setActiveTuiConfig } from "./state.js";

const mockTheme = {
  fg: (_token: string, value: string) => value,
  bg: (token: string, value: string) => `[bg:${token}]${value}[/bg]`,
  bold: (value: string) => value,
} as never;

afterEach(() => {
  resetActiveTuiConfig();
});

describe("roundedFrame", () => {
  it("supports rounded, sharp, square, double, and dashed border styles", () => {
    const doubleLines = roundedFrame(["hello"], 20, mockTheme, "Title", {
      borderStyle: "double",
    });
    expect(doubleLines[0]?.startsWith("╔═")).toBe(true);
    expect(doubleLines[0]?.endsWith("╗")).toBe(true);
    expect(doubleLines[1]?.startsWith("║ ")).toBe(true);
    expect(doubleLines[2]?.startsWith("╚")).toBe(true);
    expect(doubleLines[2]?.endsWith("╝")).toBe(true);
    for (const line of doubleLines) expect(visibleWidth(line)).toBe(20);

    const squareLines = roundedFrame(["hello"], 20, mockTheme, undefined, {
      borderStyle: "square",
    });
    expect(squareLines[0]?.startsWith("┌")).toBe(true);
    expect(squareLines[2]?.startsWith("└")).toBe(true);

    const dashedLines = roundedFrame(["hello"], 20, mockTheme, undefined, {
      borderStyle: "dashed",
    });
    expect(dashedLines[0]).toContain("┈");
    expect(dashedLines[1]?.startsWith("┊")).toBe(true);
  });

  it("handles none border cleanly with title row and width padding", () => {
    const lines = roundedFrame(["alpha", "beta"], 16, mockTheme, "Header", {
      borderStyle: "none",
      overlaySurface: "card",
    });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("[bg:userMessageBg]Header          [/bg]");
    expect(lines[1]).toBe("[bg:userMessageBg]alpha           [/bg]");
    expect(lines[2]).toBe("[bg:userMessageBg]beta            [/bg]");
  });

  it("inherits borderStyle and overlaySurface from active TUI config", () => {
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      borderStyle: "sharp",
      overlaySurface: "contrast",
    });
    const lines = roundedFrame(["row"], 12, mockTheme);
    expect(lines[0]).toContain("[bg:selectedBg]┌");
    expect(lines[1]).toContain("[bg:selectedBg]│ row");
    expect(lines[2]).toContain("[bg:selectedBg]└");
  });
});
