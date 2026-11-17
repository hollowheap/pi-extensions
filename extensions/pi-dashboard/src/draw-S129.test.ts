import { describe, expect, it, vi } from "vitest";
import { createDashboard } from "./index.js";

function dashboard(run: (...args: never[]) => Promise<string>, notify: () => void) {
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
});
