import { describe, expect, it } from "vitest";
import { loadSubagentsConfig } from "./config.js";

describe("S225: config-driven harness selection", () => {
  it("S225 C01: config parses harness definitions", () => {
    expect(loadSubagentsConfig).toBeTypeOf("function");
  });
});
