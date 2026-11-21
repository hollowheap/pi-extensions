import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isAbortOrTimeout } from "@hollowheap/runtime/abort";
import type { QuestionDialogOptions } from "./text.js";

export interface QuestionLockScope {
  lockOptions: QuestionDialogOptions;
  isCancellation(error: unknown): boolean;
}

export function createQuestionLockScope(
  ctx: ExtensionContext,
  options?: QuestionDialogOptions,
): QuestionLockScope {
  const lockOptions = {
    signal: options?.signal ?? (ctx as { signal?: AbortSignal }).signal,
    timeoutMs: options?.timeoutMs,
  };
  return {
    lockOptions,
    isCancellation: (error) => isAbortOrTimeout(error, lockOptions.signal),
  };
}
