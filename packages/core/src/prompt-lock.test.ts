import { describe, expect, it } from "vitest";
import { withPromptLock } from "./prompt-lock.js";

describe("prompt-lock", () => {
  it("runs operations in FIFO order", async () => {
    const order: number[] = [];
    const releases: Array<() => void> = [];

    const first = withPromptLock(async () => {
      order.push(1);
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      return "first";
    });

    // Allow the first operation to acquire.
    await Promise.resolve();

    const second = withPromptLock(async () => {
      order.push(2);
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      return "second";
    });

    // Second must wait while first holds the lock.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([1]);

    releases[0]();
    const firstResult = await first;
    expect(firstResult).toBe("first");

    // Let the second operation acquire and run.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([1, 2]);

    releases[1]();
    const secondResult = await second;
    expect(secondResult).toBe("second");
  });

  it("releases after resolve", async () => {
    const a = await withPromptLock(async () => 42);
    expect(a).toBe(42);
    const b = await withPromptLock(async () => "next");
    expect(b).toBe("next");
  });

  it("releases after rejection", async () => {
    await expect(
      withPromptLock(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const result = await withPromptLock(async () => "recovered");
    expect(result).toBe("recovered");
  });

  it("releases after a cancellation result", async () => {
    const cancelled = await withPromptLock(async () => ({
      cancelled: true,
    }));
    expect(cancelled).toEqual({ cancelled: true });

    const next = await withPromptLock(async () => "after-cancel");
    expect(next).toBe("after-cancel");
  });

  it("rejects nested acquisition", async () => {
    await expect(
      withPromptLock(async () => {
        await withPromptLock(async () => "inner");
        return "outer";
      }),
    ).rejects.toThrow(/nested/i);
  });

  it("shares one instance through the process-global symbol", async () => {
    const result = await withPromptLock(async () => "global");
    expect(result).toBe("global");
    const globalState = (globalThis as Record<symbol, unknown>)[
      Symbol.for("@hollowheap/core/prompt-lock")
    ];
    expect(globalState).toBeDefined();
  });

  it("rejects an aborted waiter and removes it from the queue", async () => {
    let releaseFirst!: () => void;
    const order: string[] = [];

    const first = withPromptLock(async () => {
      order.push("first");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return "first";
    });

    await Promise.resolve();

    const controller = new AbortController();
    const abortedWaiter = withPromptLock(
      async () => {
        order.push("aborted");
        return "aborted";
      },
      { signal: controller.signal },
    );

    const third = withPromptLock(async () => {
      order.push("third");
      return "third";
    });

    controller.abort(new Error("waiter cancelled"));
    await expect(abortedWaiter).rejects.toThrow("waiter cancelled");

    releaseFirst();
    await expect(first).resolves.toBe("first");
    await expect(third).resolves.toBe("third");
    expect(order).toEqual(["first", "third"]);
  });

  it("rejects a timed-out waiter and leaves the queue", async () => {
    let releaseFirst!: () => void;
    const order: string[] = [];

    const first = withPromptLock(async () => {
      order.push("first");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return "first";
    });

    await Promise.resolve();

    const timedOutWaiter = withPromptLock(
      async () => {
        order.push("timed-out");
        return "timed-out";
      },
      { timeoutMs: 15 },
    );

    await expect(timedOutWaiter).rejects.toThrow(/timed out/i);

    releaseFirst();
    await expect(first).resolves.toBe("first");

    const after = await withPromptLock(async () => {
      order.push("after");
      return "after";
    });
    expect(after).toBe("after");
    expect(order).toEqual(["first", "after"]);
  });

  it("releases the lock when an active holder aborts", async () => {
    const controller = new AbortController();
    const hungHolder = withPromptLock(() => new Promise<string>(() => {}), {
      signal: controller.signal,
    });

    await Promise.resolve();
    controller.abort();

    await expect(hungHolder).rejects.toThrow(/abort/i);

    const next = await withPromptLock(async () => "unblocked");
    expect(next).toBe("unblocked");
  });

  it("allows acquisition from a timer scheduled inside a completed lock", async () => {
    let timerPromise!: Promise<string>;
    await withPromptLock(async () => {
      timerPromise = new Promise<string>((resolve, reject) => {
        setTimeout(() => {
          withPromptLock(async () => "from-timer").then(resolve, reject);
        }, 5);
      });
    });

    await expect(timerPromise).resolves.toBe("from-timer");
  });
});
