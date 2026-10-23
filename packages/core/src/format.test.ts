import { describe, expect, it } from "vitest";
import { displayPath, displayTarget, truncateText } from "./format.js";

describe("truncateText", () => {
  it("leaves short text unchanged", () => {
    expect(truncateText("short")).toBe("short");
    expect(truncateText("x".repeat(4000))).toBe("x".repeat(4000));
  });

  it("keeps 3000 head and 1000 tail characters", () => {
    const text = `${"a".repeat(3000)}${"b".repeat(1000)}${"c".repeat(1000)}`;
    const result = truncateText(text);
    expect(result).toBe(
      `${"a".repeat(3000)}\n[truncated: cut 1000 characters]\n${"c".repeat(1000)}`,
    );
  });

  it("accepts a caller label", () => {
    expect(truncateText("x".repeat(5000), "acp")).toContain(
      "[acp: cut 1000 characters]",
    );
  });
});

describe("displayTarget", () => {
  it("truncates past 500 characters with an ellipsis", () => {
    const target = "x".repeat(600);
    expect(displayTarget(target)).toBe(`${"x".repeat(500)}…`);
    expect(displayTarget("x".repeat(500))).toBe("x".repeat(500));
  });
});

describe("displayPath", () => {
  it("returns a posix relative path", () => {
    expect(displayPath("/work", "/work/src/a.ts")).toBe("src/a.ts");
    expect(displayPath("/work", "/work/")).toBe("");
    expect(displayPath("/work", "/other/a.ts")).toBe("../other/a.ts");
  });
});
