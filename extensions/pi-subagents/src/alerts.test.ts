import { describe, expect, it, vi } from "vitest";
import { SubagentAlertTracker } from "./alerts.js";

describe("subagent completion alerts", () => {
  it("emits once after a running subagent becomes terminal", async () => {
    const tracker = new SubagentAlertTracker();
    const notify = vi.fn(() => true);
    tracker.seed({ id: "subagent-1", status: "running" });

    await tracker.observe([{ id: "subagent-1", status: "completed" }], {
      platform: "linux",
      notify,
    });
    await tracker.observe([{ id: "subagent-1", status: "completed" }], {
      platform: "linux",
      notify,
    });

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      event: "subagent-completion",
      id: "subagent-1",
      status: "completed",
    });
  });

  it("does not alert for subagents first seen terminal", async () => {
    const tracker = new SubagentAlertTracker();
    const notify = vi.fn(() => true);

    await tracker.observe([{ id: "subagent-1", status: "failed" }], {
      platform: "linux",
      notify,
    });

    expect(notify).not.toHaveBeenCalled();
  });

  it("ignores delivery failures", async () => {
    const tracker = new SubagentAlertTracker();
    const fallback = vi.fn();
    tracker.seed({ id: "subagent-1", status: "starting" });
    tracker.seed({ id: "subagent-2", status: "running" });

    await tracker.observe(
      [
        { id: "subagent-1", status: "failed" },
        { id: "subagent-2", status: "cancelled" },
      ],
      { platform: "darwin", fallback },
    );

    expect(fallback).toHaveBeenCalledTimes(2);
  });
});
