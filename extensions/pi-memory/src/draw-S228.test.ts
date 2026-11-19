import { messageCost } from "@hollowheap/core/pricing";
import { describe, expect, it } from "vitest";

describe("S228: shared pricing for observer spend", () => {
  it("S228 C01: core pricing is available to memory", () => {
    expect(messageCost).toBeTypeOf("function");
  });
});
