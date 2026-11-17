import { describe, expect, it, vi } from "vitest";
import { deliverAgentCompletionAlert } from "./alerts.js";

describe("S166 agent completion alert", () => {
  it("delivers one alert whose payload contains only event and status", async () => {
    const notify = vi.fn(() => true);

    await deliverAgentCompletionAlert({ platform: "linux", notify });

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      event: "completion",
      status: "settled",
    });
  });
});
