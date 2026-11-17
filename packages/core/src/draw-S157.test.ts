import { describe, expect, it, vi } from "vitest";
import { buildAlertPayload, deliverAlert } from "./alerts.js";

describe("S157 alert delivery fallback", () => {
  it("falls back to terminal delivery when the Linux notifier is unavailable", async () => {
    const fallback = vi.fn();
    const mode = await deliverAlert(buildAlertPayload("error"), {
      platform: "linux",
      notify: () => false,
      fallback,
    });

    expect(mode).toBe("fallback");
    expect(fallback).toHaveBeenCalledWith({ event: "error" });
  });
});
