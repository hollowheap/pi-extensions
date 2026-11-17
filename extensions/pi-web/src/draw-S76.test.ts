import { describe, expect, it } from "vitest";
import { createWebFetchTool, createWebSearchTool } from "./tools.js";

describe("S76: both web tools declare codemode exposure", () => {
  it("does not expose either tool as a direct model tool", () => {
    expect(createWebSearchTool().exposure).toBe("codemode");
    expect(createWebFetchTool().exposure).toBe("codemode");
  });
});
