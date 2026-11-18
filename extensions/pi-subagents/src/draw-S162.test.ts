import { describe, expect, it, vi } from "vitest";
import { SubagentAlertTracker } from "./alerts.js";

describe("S162 subagent completion alert", () => {
  it("emits one completion alert when a running subagent becomes terminal", async () => {
    const tracker = new SubagentAlertTracker();
    const notify = vi.fn(() => true);
    tracker.seed({ id: "subagent-1", status: "running" });
    const state = [{ id: "subagent-1", status: "completed" }];

    await tracker.observe(state, { platform: "linux", notify });
    await tracker.observe(state, { platform: "linux", notify });

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      event: "subagent-completion",
      id: "subagent-1",
      status: "completed",
    });
  });

  it("S162 C02: a subagent first seen in a terminal state emits nothing", async () => {
    const tracker = new SubagentAlertTracker();
    const notify = vi.fn(() => true);

    await tracker.observe([{ id: "subagent-9", status: "failed" }], {
      platform: "linux",
      notify,
    });

    expect(notify).not.toHaveBeenCalled();
  });

  it("S162 C03: a throwing notifier does not fail the observation", async () => {
    const tracker = new SubagentAlertTracker();
    const notify = vi.fn(() => {
      throw new Error("notify-send unavailable");
    });
    tracker.seed({ id: "subagent-2", status: "running" });

    await expect(
      tracker.observe([{ id: "subagent-2", status: "cancelled" }], {
        platform: "linux",
        notify,
      }),
    ).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledOnce();
  });

  it("S162 C04: failed and cancelled subagents each emit their own status", async () => {
    const tracker = new SubagentAlertTracker();
    const notify = vi.fn(() => true);
    tracker.seed({ id: "sub-a", status: "running" });
    tracker.seed({ id: "sub-b", status: "running" });

    await tracker.observe(
      [
        { id: "sub-a", status: "failed" },
        { id: "sub-b", status: "cancelled" },
      ],
      { platform: "linux", notify },
    );

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith({
      event: "subagent-completion",
      id: "sub-a",
      status: "failed",
    });
    expect(notify).toHaveBeenCalledWith({
      event: "subagent-completion",
      id: "sub-b",
      status: "cancelled",
    });
  });
});
