import { describe, expect, it, vi } from "vitest";
import { TaskAlertTracker } from "./alerts.js";

describe("task completion alerts", () => {
  it("emits once after a running task becomes terminal", async () => {
    const tracker = new TaskAlertTracker();
    const notify = vi.fn(() => true);
    tracker.seed({ id: "task-1", status: "running" });

    await tracker.observe([{ id: "task-1", status: "completed" }], {
      platform: "linux",
      notify,
    });
    await tracker.observe([{ id: "task-1", status: "completed" }], {
      platform: "linux",
      notify,
    });

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      event: "task-completion",
      id: "task-1",
      status: "completed",
    });
  });

  it("does not alert for tasks first seen terminal", async () => {
    const tracker = new TaskAlertTracker();
    const notify = vi.fn(() => true);

    await tracker.observe([{ id: "task-1", status: "completed" }], {
      platform: "linux",
      notify,
    });

    expect(notify).not.toHaveBeenCalled();
  });

  it("alerts on failure and ignores delivery errors", async () => {
    const tracker = new TaskAlertTracker();
    const fallback = vi.fn();
    tracker.seed({ id: "task-1", status: "running" });

    await tracker.observe([{ id: "task-1", status: "failed" }], {
      platform: "darwin",
      fallback,
    });

    expect(fallback).toHaveBeenCalledWith({
      event: "task-completion",
      id: "task-1",
      status: "failed",
    });
  });
});
