import { AsyncLocalStorage } from "node:async_hooks";

const GLOBAL_KEY = Symbol.for("@hollowheap/core/prompt-lock");

interface Waiter {
  resolve: () => void;
}

interface PromptLockState {
  locked: boolean;
  activeToken?: symbol;
  queue: Waiter[];
}

export interface PromptLockOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface PromptLockGlobal {
  als: AsyncLocalStorage<symbol>;
  state: PromptLockState;
}

function getGlobal(): PromptLockGlobal {
  const store = globalThis as unknown as Record<
    symbol,
    PromptLockGlobal | undefined
  >;
  const existing = store[GLOBAL_KEY];
  if (existing !== undefined) return existing;
  const created: PromptLockGlobal = {
    als: new AsyncLocalStorage<symbol>(),
    state: { locked: false, queue: [] },
  };
  store[GLOBAL_KEY] = created;
  return created;
}

function pump(state: PromptLockState): void {
  if (state.locked) return;
  const next = state.queue.shift();
  if (next === undefined) return;
  state.locked = true;
  next.resolve();
}

function toAbortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  if (typeof reason === "string" && reason.length > 0) {
    return new Error(reason);
  }
  return new Error("prompt lock: aborted");
}

export async function withPromptLock<T>(
  operation: () => T | Promise<T>,
  options?: PromptLockOptions,
): Promise<T> {
  const global = getGlobal();
  const currentToken = global.als.getStore();
  if (
    currentToken !== undefined &&
    global.state.locked &&
    currentToken === global.state.activeToken
  ) {
    throw new Error("prompt lock: nested acquisition is not allowed");
  }

  const signal = options?.signal;
  const timeoutMs = options?.timeoutMs;
  if (signal?.aborted) {
    throw toAbortError(signal);
  }
  if (timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs <= 0) {
    throw new Error("prompt lock: timed out");
  }

  const token = Symbol("prompt-lock");
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    if (global.state.activeToken === token) {
      global.state.activeToken = undefined;
    }
    global.state.locked = false;
    pump(global.state);
  };

  let acquired = false;
  let cancelHold: ((error: Error) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cleanup = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    signal?.removeEventListener("abort", onAbort);
  };

  let rejectWait: ((error: Error) => void) | undefined;
  let waiterRef: Waiter | undefined;

  const fail = (error: Error): void => {
    cleanup();
    if (!acquired) {
      if (waiterRef !== undefined) {
        const index = global.state.queue.indexOf(waiterRef);
        if (index !== -1) {
          global.state.queue.splice(index, 1);
        }
      }
      rejectWait?.(error);
      return;
    }
    release();
    queueMicrotask(() => {
      cancelHold?.(error);
    });
  };

  const onAbort = (): void => {
    fail(
      signal !== undefined
        ? toAbortError(signal)
        : new Error("prompt lock: aborted"),
    );
  };

  if (signal !== undefined) {
    signal.addEventListener("abort", onAbort, { once: true });
  }
  if (timeoutMs !== undefined && Number.isFinite(timeoutMs)) {
    timer = setTimeout(() => {
      fail(new Error("prompt lock: timed out"));
    }, timeoutMs);
  }

  try {
    await new Promise<void>((resolve, reject) => {
      rejectWait = reject;
      const waiter: Waiter = {
        resolve: () => {
          acquired = true;
          global.state.activeToken = token;
          resolve();
        },
      };
      waiterRef = waiter;
      global.state.queue.push(waiter);
      pump(global.state);
    });
  } catch (error) {
    cleanup();
    throw error;
  }

  if (released) {
    cleanup();
    throw signal?.aborted
      ? toAbortError(signal)
      : new Error("prompt lock: timed out");
  }

  try {
    return await global.als.run(token, async () => {
      const holdFailure = new Promise<never>((_resolve, reject) => {
        cancelHold = reject;
      });
      return await Promise.race([
        Promise.resolve().then(operation),
        holdFailure,
      ]);
    });
  } finally {
    cleanup();
    release();
  }
}
