import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { attachStdioShutdown, finishShutdown } from "../src/main.js";

describe("stdio lifecycle", () => {
  it("shuts down once when stdin reaches EOF", () => {
    const input = new PassThrough();
    const shutdown = vi.fn();
    attachStdioShutdown(input, shutdown);

    input.end();
    input.emit("close");
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("awaits cleanup before exiting", async () => {
    let resolveCleanup: () => void = () => {};
    const cleanup = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    const exit = vi.fn();
    const pending = finishShutdown(() => cleanup, exit);
    await Promise.resolve();

    expect(exit).not.toHaveBeenCalled();
    resolveCleanup();
    await pending;
    expect(exit).toHaveBeenCalledWith(0);
  });
});
