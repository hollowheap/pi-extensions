import { describe, expect, it } from "vitest";
import {
  USAGE_ENTRY_TYPE,
  extractLatestUsage,
  restoreSessionUsage,
} from "@hollowheap/core/usage";

function entry(inputTokens: number, outputTokens: number, totalCost: number) {
  return {
    type: "custom",
    customType: USAGE_ENTRY_TYPE,
    data: { inputTokens, outputTokens, totalCost },
  };
}

describe("S111 usage persistence across compaction", () => {
  it("restores the latest stored usage entry from the active branch", () => {
    const entries = [entry(10, 5, 0.1), entry(20, 10, 0.25)];
    expect(extractLatestUsage(entries).totalTokens).toBe(30);
    expect(extractLatestUsage(entries).totalCost).toBe(0.25);

    const manager = { getBranch: () => entries };
    const restored = restoreSessionUsage(manager);
    expect(restored.inputTokens).toBe(20);
    expect(restored.outputTokens).toBe(10);
    expect(restored.totalCost).toBe(0.25);
  });
});
