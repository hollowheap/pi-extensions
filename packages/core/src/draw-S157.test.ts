import { describe, expect, it, vi } from "vitest";
import { AlertDispatcher, buildAlertPayload, deliverAlert } from "./alerts.js";

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

  it("S157 C02: a working Linux notifier delivers natively and skips fallback", async () => {
    const notify = vi.fn(() => true);
    const fallback = vi.fn();
    const payload = buildAlertPayload("completion");

    const mode = await deliverAlert(payload, {
      platform: "linux",
      notify,
      fallback,
    });

    expect(mode).toBe("native");
    expect(notify).toHaveBeenCalledWith(payload);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("S157 C03: unsupported native platforms go straight to fallback", async () => {
    const notify = vi.fn(() => true);
    const fallback = vi.fn();

    const mode = await deliverAlert(buildAlertPayload("error"), {
      platform: "darwin",
      notify,
      fallback,
    });

    expect(mode).toBe("fallback");
    expect(notify).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("S157 C04: the dispatcher reports a repeated event/id as duplicate", async () => {
    const fallback = vi.fn();
    const dispatcher = new AlertDispatcher();
    const payload = buildAlertPayload("question", "q-1", "asked");
    const delivery = {
      platform: "linux" as const,
      notify: () => true,
      fallback,
    };

    expect(await dispatcher.dispatch(payload, delivery)).toBe("native");
    expect(await dispatcher.dispatch(payload, delivery)).toBe("duplicate");
    expect(fallback).not.toHaveBeenCalled();
  });
});
