import { describe, expect, it } from "vitest";
import { messageCost } from "@hollowheap/core/pricing";

describe("S228: shared pricing for observer spend", () => {
  it("S228 C01: core pricing is available to memory", () => {
    expect(messageCost).toBeTypeOf("function");
  });
});
