import { describe, expect, it, vi } from "vitest";
import { TaskAlertTracker } from "../src/alerts.js";

describe("task completion alert", () => {
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

  it("a task first seen in a terminal state emits nothing", async () => {
    const tracker = new TaskAlertTracker();
    const notify = vi.fn(() => true);

    await tracker.observe([{ id: "task-9", status: "completed" }], {
      platform: "linux",
      notify,
    });

    expect(notify).not.toHaveBeenCalled();
  });

  it("a throwing notifier does not fail the observation", async () => {
    const tracker = new TaskAlertTracker();
    const notify = vi.fn(() => {
      throw new Error("notify-send unavailable");
    });
    tracker.seed({ id: "task-2", status: "running" });

    await expect(
      tracker.observe([{ id: "task-2", status: "failed" }], {
        platform: "linux",
        notify,
      }),
    ).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledOnce();
  });

  it("failed and cancelled tasks each emit their own status", async () => {
    const tracker = new TaskAlertTracker();
    const notify = vi.fn(() => true);
    tracker.seed({ id: "task-a", status: "running" });
    tracker.seed({ id: "task-b", status: "running" });

    await tracker.observe(
      [
        { id: "task-a", status: "failed" },
        { id: "task-b", status: "cancelled" },
      ],
      { platform: "linux", notify },
    );

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith({
      event: "task-completion",
      id: "task-a",
      status: "failed",
    });
    expect(notify).toHaveBeenCalledWith({
      event: "task-completion",
      id: "task-b",
      status: "cancelled",
    });
  });
});
