import { describe, expect, it, vi } from "vitest";
import { withPromptLock } from "../src/prompt-lock.js";

describe("prompt lock abort", () => {
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

  it("a queued waiter times out while the holder still completes", async () => {
    let release!: () => void;
    const holder = withPromptLock(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve("done");
        }),
    );
    await Promise.resolve();

    const waiter = withPromptLock(async () => "waiter", { timeoutMs: 10 });

    await expect(waiter).rejects.toThrow("timed out");
    release();
    await expect(holder).resolves.toBe("done");
  });

  it("nested acquisition from an active holder is rejected", async () => {
    const nested = withPromptLock(async () => {
      await withPromptLock(async () => "inner");
      return "outer";
    });

    await expect(nested).rejects.toThrow("nested acquisition is not allowed");
  });

  it("an already-aborted signal rejects before the operation runs", async () => {
    const operation = vi.fn(async () => "unused");
    const controller = new AbortController();
    controller.abort(new Error("pre-cancelled"));

    await expect(
      withPromptLock(operation, { signal: controller.signal }),
    ).rejects.toThrow("pre-cancelled");
    expect(operation).not.toHaveBeenCalled();
  });
});
