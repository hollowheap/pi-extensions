import { describe, expect, it } from "vitest";
import { observeConversation } from "./observer.js";

describe("S227: observation source-entry watermark", () => {
  it("S227 C01: observer is available for watermark tracking", () => {
    expect(observeConversation).toBeTypeOf("function");
  });
});
