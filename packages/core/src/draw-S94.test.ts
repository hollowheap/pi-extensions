import { describe, expect, it } from "vitest";
import { withPromptLock } from "@hollowheap/core/prompt-lock";

describe("S94 process-wide FIFO prompt queue", () => {
  it("runs blocking prompts one at a time in acquisition order", async () => {
    const order: string[] = [];
    const first = withPromptLock(async () => {
      order.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("first:end");
    });
    const second = withPromptLock(async () => {
      order.push("second");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("rejects a nested acquisition instead of deadlocking", async () => {
    await expect(
      withPromptLock(() => withPromptLock(() => 1)),
    ).rejects.toThrow(/nested/);
  });
});
