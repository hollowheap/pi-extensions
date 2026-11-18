import { describe, expect, it, vi } from "vitest";
import { deliverQuestionAlert } from "./alerts.js";

describe("S165 question alert", () => {
  it("delivers one alert whose payload contains only event and status", async () => {
    const notify = vi.fn(() => true);

    await deliverQuestionAlert({ platform: "linux", notify });

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      event: "question",
      status: "asked",
    });
  });

  it("S165 C02: a throwing notifier never blocks the question dialog", async () => {
    const notify = vi.fn(() => {
      throw new Error("notify-send unavailable");
    });

    await expect(
      deliverQuestionAlert({ platform: "linux", notify }),
    ).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledOnce();
  });

  it("S165 C03: a declined native notification still reaches the fallback", async () => {
    const fallback = vi.fn();

    await deliverQuestionAlert({
      platform: "linux",
      notify: () => false,
      fallback,
    });

    expect(fallback).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledWith({
      event: "question",
      status: "asked",
    });
  });

  it("S165 C04: separate question alerts are not deduplicated at this seam", async () => {
    const notify = vi.fn(() => true);

    await deliverQuestionAlert({ platform: "linux", notify });
    await deliverQuestionAlert({ platform: "linux", notify });

    expect(notify).toHaveBeenCalledTimes(2);
  });
});
