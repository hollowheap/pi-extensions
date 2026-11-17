import { describe, expect, it } from "vitest";
import { withPromptLock } from "./prompt-lock.js";

describe("S180 prompt lock abort", () => {
  it("rejects a waiter when its signal aborts and still releases the holder", async () => {
    let release!: () => void;
    const holder = withPromptLock(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve("held");
        }),
    );
    await Promise.resolve();

    const controller = new AbortController();
    const waiter = withPromptLock(async () => "waiter", {
      signal: controller.signal,
    });
    controller.abort(new Error("waiter cancelled"));

    await expect(waiter).rejects.toThrow("waiter cancelled");
    release();
    await expect(holder).resolves.toBe("held");
  });
});
