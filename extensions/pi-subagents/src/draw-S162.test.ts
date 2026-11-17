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
});
