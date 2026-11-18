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

  it("S166 C02: a throwing notifier never affects the footer", async () => {
    const notify = vi.fn(() => {
      throw new Error("notify-send unavailable");
    });

    await expect(
      deliverAgentCompletionAlert({ platform: "linux", notify }),
    ).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledOnce();
  });

  it("S166 C03: a declined native notification still reaches the fallback", async () => {
    const fallback = vi.fn();

    await deliverAgentCompletionAlert({
      platform: "linux",
      notify: () => false,
      fallback,
    });

    expect(fallback).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledWith({
      event: "completion",
      status: "settled",
    });
  });

  it("S166 C04: separate agent completions are not deduplicated at this seam", async () => {
    const notify = vi.fn(() => true);

    await deliverAgentCompletionAlert({ platform: "linux", notify });
    await deliverAgentCompletionAlert({ platform: "linux", notify });

    expect(notify).toHaveBeenCalledTimes(2);
  });
});
