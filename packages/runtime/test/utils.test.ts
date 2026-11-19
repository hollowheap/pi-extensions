import { describe, expect, it } from "vitest";
import { errorMessage, isRecord } from "../src/utils.js";

describe("runtime internal utils", () => {
  it("isRecord narrows plain objects and rejects arrays, null, and primitives", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("str")).toBe(false);
    expect(isRecord(42)).toBe(false);
  });

  it("errorMessage extracts Error.message and stringifies non-Error values", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(404)).toBe("404");
  });
});
