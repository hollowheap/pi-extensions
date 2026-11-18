import { describe, expect, it, vi } from "vitest";
import { createDashboard } from "./index.js";

function dashboard(
  run: (
    command: string,
    args: string[],
    signal: AbortSignal | undefined,
  ) => Promise<string>,
  notify: () => void,
) {
  return createDashboard(
    {
      width: 80,
      sections: [
        { type: "terminal", command: "echo", args: [], intervalMs: 0, gap: 0 },
      ],
    },
    { run, notify },
  );
}

describe("S129 dashboard refresh and error display", () => {
  it("shows failures, then refreshes to recovered output", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("recovered text");
    const notify = vi.fn();
    const controller = dashboard(run as never, notify);
    try {
      await controller.refresh();
      expect(notify).toHaveBeenCalledWith("boom");
      expect(controller.lines().join("\n")).toContain("boom");

      await controller.refresh();
      expect(controller.lines().join("\n")).toContain("recovered text");
    } finally {
      controller.stop();
    }
  });

  it("S129 C02: a config with no sections renders and refreshes empty", async () => {
    const run = vi.fn(async () => "unused");
    const controller = createDashboard(
      { width: 80, sections: [] },
      { run, notify: vi.fn() },
    );
    await controller.refresh();
    expect(controller.lines()).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it("S129 C03: repeated failures notify once while lines keep the error", async () => {
    const run = vi.fn(async () => {
      throw new Error("still down");
    });
    const notify = vi.fn();
    const controller = dashboard(run as never, notify);
    try {
      await controller.refresh();
      await controller.refresh();
      expect(notify).toHaveBeenCalledTimes(1);
      expect(controller.lines().join("\n")).toContain("still down");
    } finally {
      controller.stop();
    }
  });

  it("S129 C04: the interval refreshes and requests a re-render", async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn(async () => "periodic");
      const requestRender = vi.fn();
      const controller = createDashboard(
        {
          width: 80,
          sections: [
            {
              type: "terminal",
              command: "echo",
              args: [],
              intervalMs: 1_000,
              gap: 0,
            },
          ],
        },
        { run, notify: vi.fn() },
      );
      controller.start(requestRender);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(run).toHaveBeenCalledTimes(1);
      expect(requestRender).toHaveBeenCalled();
      expect(controller.lines().join("\n")).toContain("periodic");
      controller.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
