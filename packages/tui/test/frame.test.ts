import { visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_TUI_CONFIG } from "@hollowheap/core/tui-config";
import { afterEach, describe, expect, it } from "vitest";
import { boxFrame, framePanelLines, getFrameInnerWidth } from "../src/frame.js";
import {
  bindHostOutputPadding,
  resetActiveTuiConfig,
  setActiveTuiConfig,
} from "../src/state.js";

const mockTheme = {
  fg: (_token: string, value: string) => value,
  bg: (token: string, value: string) => `[bg:${token}]${value}[/bg]`,
  bold: (value: string) => value,
} as never;

afterEach(() => {
  resetActiveTuiConfig();
});

describe("boxFrame", () => {
  it("supports rounded, sharp, square, double, and dashed border styles", () => {
    const doubleLines = boxFrame(["hello"], 20, mockTheme, "Title", {
      borderStyle: "double",
    });
    expect(doubleLines[0]?.startsWith("╔═")).toBe(true);
    expect(doubleLines[0]?.endsWith("╗")).toBe(true);
    expect(doubleLines[1]?.startsWith("║ ")).toBe(true);
    expect(doubleLines[2]?.startsWith("╚")).toBe(true);
    expect(doubleLines[2]?.endsWith("╝")).toBe(true);
    for (const line of doubleLines) expect(visibleWidth(line)).toBe(20);

    const squareLines = boxFrame(["hello"], 20, mockTheme, undefined, {
      borderStyle: "square",
    });
    expect(squareLines[0]?.startsWith("┌")).toBe(true);
    expect(squareLines[2]?.startsWith("└")).toBe(true);

    const dashedLines = boxFrame(["hello"], 20, mockTheme, undefined, {
      borderStyle: "dashed",
    });
    expect(dashedLines[0]?.startsWith("┌┄")).toBe(true);
    expect(dashedLines[0]?.endsWith("┐")).toBe(true);
    expect(dashedLines[1]?.startsWith("┆")).toBe(true);
    expect(dashedLines[2]?.startsWith("└┄")).toBe(true);
    expect(dashedLines[2]?.endsWith("┘")).toBe(true);

    const dottedLines = boxFrame(["hello"], 20, mockTheme, undefined, {
      borderStyle: "dotted",
    });
    expect(dottedLines[0]?.startsWith("┌┈")).toBe(true);
    expect(dottedLines[0]?.endsWith("┐")).toBe(true);
    expect(dottedLines[1]?.startsWith("┊")).toBe(true);
    expect(dottedLines[2]?.startsWith("└┈")).toBe(true);
    expect(dottedLines[2]?.endsWith("┘")).toBe(true);
  });

  it("handles none border and surface styles with borderless host padding + 1", () => {
    const lines = boxFrame(["alpha", "beta"], 16, mockTheme, "Header", {
      borderStyle: "none",
      overlaySurface: "card",
    });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("[bg:userMessageBg] Header         [/bg]");
    expect(lines[1]).toBe("[bg:userMessageBg] alpha          [/bg]");
    expect(lines[2]).toBe("[bg:userMessageBg] beta           [/bg]");
  });

  it("preserves borders and paints surface background when surface style is active", () => {
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      borderStyle: "rounded",
      overlaySurface: "surface",
    });
    const lines = boxFrame(["row"], 12, mockTheme);
    expect(lines).toEqual([
      "[bg:customMessageBg]╭──────────╮[/bg]",
      "[bg:customMessageBg]│ row      │[/bg]",
      "[bg:customMessageBg]╰──────────╯[/bg]",
    ]);
    expect(getFrameInnerWidth(12)).toBe(8);

    const restore = bindHostOutputPadding(() => 1);
    try {
      expect(getFrameInnerWidth(12)).toBe(8);
      expect(boxFrame(["row"], 12, mockTheme)).toEqual([
        "[bg:customMessageBg]╭──────────╮[/bg]",
        "[bg:customMessageBg]│ row      │[/bg]",
        "[bg:customMessageBg]╰──────────╯[/bg]",
      ]);
    } finally {
      restore();
    }

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      borderStyle: "sharp",
      overlaySurface: "surface",
      colored: false,
    });
    const uncolored = boxFrame(["row"], 12, mockTheme);
    expect(uncolored[0]).toBe("┌──────────┐");
    expect(uncolored[1]).toBe("│ row      │");
    expect(uncolored[2]).toBe("└──────────┘");
  });
});

it("uses Pi's output padding for the box and its content width", () => {
  let padding: 0 | 1 = 0;
  const restore = bindHostOutputPadding(() => padding);
  try {
    expect(boxFrame(["word"], 12, mockTheme)[1]).toBe("│word      │");
    padding = 1;
    expect(boxFrame(["word"], 12, mockTheme)[1]).toBe("│ word     │");
    expect(
      boxFrame(["a"], 4, mockTheme).every((line) => visibleWidth(line) === 4),
    ).toBe(true);
  } finally {
    restore();
  }
});

describe("framePanelLines", () => {
  it("keeps outputPad horizontal only without adding vertical padding rows", () => {
    const lines = framePanelLines(["hello"], 16, mockTheme, {
      borderStyle: "rounded",
      accentStripe: false,
      outputPad: 1,
      stateToken: "toolSuccessBg",
      includeTop: true,
      includeBottom: true,
      colored: false,
    });
    expect(lines).toEqual([
      "╭──────────────╮",
      "│ hello        │",
      "╰──────────────╯",
    ]);
  });

  it("preserves border-width padding with spaces when borderStyle is none", () => {
    const bordered = framePanelLines(["hello"], 16, mockTheme, {
      borderStyle: "rounded",
      accentStripe: false,
      outputPad: 1,
      stateToken: "toolSuccessBg",
      includeTop: true,
      includeBottom: true,
      colored: false,
    });
    const borderless = framePanelLines(["hello"], 16, mockTheme, {
      borderStyle: "none",
      accentStripe: false,
      outputPad: 1,
      stateToken: "toolSuccessBg",
      includeTop: true,
      includeBottom: true,
      colored: false,
    });
    expect(borderless).toHaveLength(bordered.length);
    expect(borderless).toEqual([
      " ".repeat(16),
      "  hello         ",
      " ".repeat(16),
    ]);
    for (const line of borderless) expect(visibleWidth(line)).toBe(16);
  });
});
