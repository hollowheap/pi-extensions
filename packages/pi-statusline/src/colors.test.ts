import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  type TextStyle,
  parseColorSpec,
  styleComponent,
  styleText,
} from "./colors.js";

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

describe("styleComponent", () => {
  function theme(style?: (text: string, options: unknown) => string): Theme {
    return { style: style ?? ((text: string) => text) } as unknown as Theme;
  }

  it("returns empty string when text is empty", () => {
    const style = vi.fn((text: string) => `[${text}]`);
    expect(
      styleComponent(
        "",
        { accent: parseColorSpec("bright-yellow"), icon: "" },
        theme(style),
      ),
    ).toBe("");
    expect(style).not.toHaveBeenCalled();
  });

  it("delegates to styleText when accent is undefined", () => {
    const style = vi.fn((text: string) => `[${text}]`);
    expect(styleComponent("hi", { fg: "dim" }, theme(style))).toBe("[hi]");
    expect(style).toHaveBeenCalledWith("hi", { fg: "dim" });
  });

  it("renders a two-tone pill when accent and icon are provided", () => {
    const calls: Array<{ text: string; options: unknown }> = [];
    const t = theme((text, options) => {
      calls.push({ text, options });
      return `(${text})`;
    });
    const cyan = parseColorSpec("bright-cyan");
    const result = styleComponent("main", { accent: cyan, icon: "" }, t);
    expect(result).toBe("()( )( main )()");
    expect(calls[0]).toEqual({ text: "", options: { fg: cyan } });
    expect(calls[1]).toEqual({
      text: " ",
      options: { fg: { kind: "indexed", index: 0 }, bg: cyan },
    });
    expect(calls[2]).toEqual({
      text: " main ",
      options: {
        fg: { kind: "indexed", index: 0 },
        bg: { kind: "indexed", index: 15 },
      },
    });
    expect(calls[3]).toEqual({
      text: "",
      options: { fg: { kind: "indexed", index: 15 } },
    });
  });

  it("renders a single-tone pill when icon is omitted", () => {
    const calls: Array<{ text: string; options: unknown }> = [];
    const t = theme((text, options) => {
      calls.push({ text, options });
      return `(${text})`;
    });
    const magenta = parseColorSpec("bright-magenta");
    const result = styleComponent("42%", { accent: magenta }, t);
    expect(result).toBe("()( 42% )()");
    expect(calls[0]).toEqual({ text: "", options: { fg: magenta } });
    expect(calls[1]).toEqual({
      text: " 42% ",
      options: { fg: { kind: "indexed", index: 0 }, bg: magenta },
    });
    expect(calls[2]).toEqual({
      text: "",
      options: { fg: magenta },
    });
  });
});
