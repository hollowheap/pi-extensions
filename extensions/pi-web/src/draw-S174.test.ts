import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "./extract.js";

describe("S174 linear-time HTML conversion", () => {
  it("converts hostile unclosed markup quickly and without throwing", () => {
    const hostile = `<${"a".repeat(200_000)}`;
    const start = performance.now();
    const output = htmlToMarkdown(hostile);
    const duration = performance.now() - start;

    expect(output).toBe(hostile);
    expect(duration).toBeLessThan(1_000);
  });
});
