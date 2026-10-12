import { describe, expect, it } from "vitest";
import { parseColorSpec } from "./colors.js";

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
