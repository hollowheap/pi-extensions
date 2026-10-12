import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { type TextStyle, parseColorSpec, styleText } from "./colors.js";

describe("parseColorSpec", () => {
  it("resolves starship named colors", () => {
    expect(parseColorSpec("red")).toEqual({ kind: "indexed", index: 1 });
    expect(parseColorSpec("white")).toEqual({ kind: "indexed", index: 7 });
    expect(parseColorSpec("purple")).toEqual({ kind: "indexed", index: 5 });
    expect(parseColorSpec("magenta")).toEqual({ kind: "indexed", index: 5 });
  });

  it("resolves bright variants case-insensitively", () => {
    expect(parseColorSpec("bright-white")).toEqual({
      kind: "indexed",
      index: 15,
    });
    expect(parseColorSpec("BRIGHT-RED")).toEqual({
      kind: "indexed",
      index: 9,
    });
  });

  it("resolves 0-255 palette numbers and strings", () => {
    expect(parseColorSpec(27)).toEqual({ kind: "indexed", index: 27 });
    expect(parseColorSpec("27")).toEqual({ kind: "indexed", index: 27 });
    expect(parseColorSpec(256)).toBeUndefined();
    expect(parseColorSpec("256")).toBeUndefined();
    expect(parseColorSpec(-1)).toBeUndefined();
    expect(parseColorSpec(4.5)).toBeUndefined();
  });

  it("resolves hex colors", () => {
    expect(parseColorSpec("#bf5700")).toEqual({
      kind: "rgb",
      r: 191,
      g: 87,
      b: 0,
    });
  });

  it("rejects unknown values", () => {
    expect(parseColorSpec("nope")).toBeUndefined();
    expect(parseColorSpec("")).toBeUndefined();
  });
});

describe("styleText", () => {
  function theme(style?: (text: string, options: unknown) => string): Theme {
    return { style: style ?? ((text: string) => text) } as unknown as Theme;
  }

  it("returns plain text without styling", () => {
    const style = vi.fn((text: string) => `[${text}]`);
    expect(styleText("hi", {}, theme(style))).toBe("hi");
    expect(style).not.toHaveBeenCalled();
  });

  it("applies fg, bg, and bold through the theme", () => {
    const style = vi.fn((text: string) => `[${text}]`);
    expect(
      styleText(
        "hi",
        { fg: "dim", bg: "selectedBg", bold: true },
        theme(style),
      ),
    ).toBe("[hi]");
    expect(style).toHaveBeenCalledWith("hi", {
      fg: "dim",
      bg: "selectedBg",
      bold: true,
    });
  });

  it("falls back to plain text when styling throws", () => {
    const throwing = {
      style: () => {
        throw new Error("Unknown theme color: nope");
      },
    } as unknown as Theme;
    expect(
      styleText("hi", { fg: "nope" } as unknown as TextStyle, throwing),
    ).toBe("hi");
  });
});
