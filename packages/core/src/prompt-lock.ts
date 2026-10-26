import { AsyncLocalStorage } from "node:async_hooks";

const GLOBAL_KEY = Symbol.for("@hollowheap/core/prompt-lock");

interface Waiter {
  resolve: () => void;
}

interface PromptLockState {
  locked: boolean;
  queue: Waiter[];
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

export async function withPromptLock<T>(
  operation: () => T | Promise<T>,
): Promise<T> {
  const global = getGlobal();
  if (global.als.getStore() !== undefined) {
    throw new Error("prompt lock: nested acquisition is not allowed");
  }

  await new Promise<void>((resolve) => {
    global.state.queue.push({ resolve });
    pump(global.state);
  });

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    global.state.locked = false;
    pump(global.state);
  };

  const token = Symbol("prompt-lock");
  try {
    return await global.als.run(token, async () => {
      try {
        return await operation();
      } finally {
        release();
      }
    });
  } catch (error) {
    release();
    throw error;
  }
}
