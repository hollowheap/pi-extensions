import { describe, expect, it } from "vitest";
import { createQuestionLockScope } from "../src/lock-scope.js";

describe("createQuestionLockScope", () => {
  it("prefers the options signal and forwards the timeout", () => {
    const optionsSignal = new AbortController().signal;
    const ctxSignal = new AbortController().signal;
    const scope = createQuestionLockScope({ signal: ctxSignal } as never, {
      signal: optionsSignal,
      timeoutMs: 250,
    });

    expect(scope.lockOptions).toEqual({
      signal: optionsSignal,
      timeoutMs: 250,
    });
  });

  it("falls back to the context signal", () => {
    const ctxSignal = new AbortController().signal;
    const scope = createQuestionLockScope({ signal: ctxSignal } as never);

    expect(scope.lockOptions.signal).toBe(ctxSignal);
    expect(scope.lockOptions.timeoutMs).toBeUndefined();
  });

  it("recognizes abort, timeout, and timed-out errors as cancellation", () => {
    const scope = createQuestionLockScope({} as never);

    expect(
      scope.isCancellation(new DOMException("aborted", "AbortError")),
    ).toBe(true);
    expect(
      scope.isCancellation(new DOMException("timed out", "TimeoutError")),
    ).toBe(true);
    expect(scope.isCancellation(new Error("prompt lock: timed out"))).toBe(
      true,
    );
    expect(scope.isCancellation(new Error("dialog exploded"))).toBe(false);
  });

  it("treats any error as cancellation after the signal aborts", () => {
    const controller = new AbortController();
    const scope = createQuestionLockScope({} as never, {
      signal: controller.signal,
    });

    expect(scope.isCancellation(new Error("dialog exploded"))).toBe(false);
    controller.abort();
    expect(scope.isCancellation(new Error("dialog exploded"))).toBe(true);
  });
});
