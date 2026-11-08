import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { fitLines, splitOutput } from "./render.js";

describe("fitLines", () => {
  it("pads narrow lines to the exact width", () => {
    expect(fitLines(["hi"], 5)).toEqual(["hi   "]);
    expect(fitLines(["hi"], 5).map((line) => visibleWidth(line))).toEqual([5]);
  });

  it("centers lines when asked", () => {
    expect(fitLines(["hi"], 5, "center")).toEqual([" hi  "]);
    expect(fitLines(["hi"], 6, "center")).toEqual(["  hi  "]);
    expect(
      fitLines(["hi"], 6, "center").map((line) => visibleWidth(line)),
    ).toEqual([6]);
  });
  it("truncates wide lines without exceeding the width", () => {
    const [line] = fitLines(["0123456789"], 4);
    expect(visibleWidth(line)).toBeLessThanOrEqual(4);
  });

  it("measures visible width through ANSI escapes", () => {
    const [line] = fitLines(["\x1b[36mhi\x1b[0m"], 5);
    expect(visibleWidth(line)).toBe(5);
    expect(line).toContain("hi");
  });
});

describe("splitOutput", () => {
  it("drops one trailing newline and keeps interior blanks", () => {
    expect(splitOutput("a\n\nb\n")).toEqual(["a", "", "b"]);
    expect(splitOutput("")).toEqual([]);
  });

  it("preserves 16-color, 256-color, and TrueColor SGR while stripping OSC, non-SGR CSI, and controls", () => {
    const raw =
      "\x1b[31m16-color\x1b[0m \x1b[38;5;208m256-color\x1b[0m \x1b[38;2;255;100;0mTrueColor\x1b[0m\n" +
      "\x1b]52;c;ZXZpbA==\x07\x1b]2;title\x07\x1b[2J\x1b[H\x1b[?25l\x00\x07clean\n";
    expect(splitOutput(raw)).toEqual([
      "\x1b[31m16-color\x1b[0m \x1b[38;5;208m256-color\x1b[0m \x1b[38;2;255;100;0mTrueColor\x1b[0m",
      "clean",
    ]);
  });
});
