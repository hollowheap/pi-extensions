import { describe, expect, it } from "vitest";
import { isRecord } from "../src/records.js";

describe("isRecord", () => {
  it("accepts plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ key: 1 })).toBe(true);
  });

  it("rejects primitives, arrays, and null", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord(1)).toBe(false);
    expect(isRecord("object")).toBe(false);
    expect(isRecord([])).toBe(false);
  });
});
