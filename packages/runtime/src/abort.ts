export function watchAbort(
  signal: AbortSignal | undefined,
  onAbort: () => void,
): () => void {
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  return () => signal?.removeEventListener("abort", onAbort);
}

export function scopedAbortSignal(options: {
  signal?: AbortSignal;
  timeoutMs?: number;
}): { signal: AbortSignal; stop: () => void } {
  const controller = new AbortController();
  const timer =
    options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs)
      ? setTimeout(
          () => controller.abort(new DOMException("Timed out", "TimeoutError")),
          options.timeoutMs,
        )
      : undefined;
  const stopWatching = watchAbort(options.signal, () =>
    controller.abort(options.signal?.reason),
  );
  return {
    signal: controller.signal,
    stop() {
      stopWatching();
      clearTimeout(timer);
    },
  };
}

export function isAbortOrTimeout(
  error: unknown,
  signal?: AbortSignal,
): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error &&
      (error.name === "AbortError" ||
        error.name === "TimeoutError" ||
        /aborted|time(?:d )?out/i.test(error.message)))
  );
}

/** Wait for the delay or for the signal. Callers decide how to handle cancellation. */
export function abortableDelay(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      release();
      resolve();
    }, ms);
    const release = watchAbort(signal, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
