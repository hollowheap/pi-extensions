import { describe, expect, it } from "vitest";
import { SubagentStore } from "./state.js";

describe("S224: single host-side task lifecycle owner", () => {
  it("S224 C01: subagent state store is available for shared lifecycle", () => {
    expect(SubagentStore).toBeTypeOf("function");
  });
});
