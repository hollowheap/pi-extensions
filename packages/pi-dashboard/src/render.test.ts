import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { fitLines, splitOutput } from "./render.js";

describe("fitLines", () => {
  it("pads narrow lines to the exact width", () => {
    expect(fitLines(["hi"], 5)).toEqual(["hi   "]);
    expect(fitLines(["hi"], 5).map((line) => visibleWidth(line))).toEqual([5]);
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
});
