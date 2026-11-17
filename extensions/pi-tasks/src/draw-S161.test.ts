import { describe, expect, it, vi } from "vitest";
import { TaskAlertTracker } from "./alerts.js";

describe("S161 task completion alert", () => {
  it("emits one completion alert when a running task becomes terminal", async () => {
    const tracker = new TaskAlertTracker();
    const notify = vi.fn(() => true);
    tracker.seed({ id: "task-1", status: "running" });
    const state = [{ id: "task-1", status: "completed" }];

    await tracker.observe(state, { platform: "linux", notify });
    await tracker.observe(state, { platform: "linux", notify });

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      event: "task-completion",
      id: "task-1",
      status: "completed",
    });
  });
});
