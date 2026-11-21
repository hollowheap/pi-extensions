import { describe, expect, it } from "vitest";
import { viewportHeight } from "../src/viewport.js";

describe("viewportHeight", () => {
  it("sizes a framed viewport from terminal rows", () => {
    expect(viewportHeight(30)).toBe(22);
    expect(viewportHeight(3)).toBe(1);
  });

  it("applies pager window and fullscreen bounds", () => {
    expect(viewportHeight(12, { min: 3, max: 8 })).toBe(7);
    expect(viewportHeight(4, { min: 3, max: 0 })).toBe(3);
    expect(viewportHeight(12, { fraction: 1, frameRows: 2 })).toBe(10);
    expect(viewportHeight(12, { fraction: 1, frameRows: 3 })).toBe(9);
    expect(viewportHeight(3, { fraction: 1, frameRows: 3 })).toBe(1);
  });
});
