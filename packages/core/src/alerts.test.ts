import { describe, expect, it, vi } from "vitest";
import {
  ALERT_EVENTS,
  AlertDispatcher,
  buildAlertPayload,
  deliverAlert,
} from "./alerts.js";

describe("alerts", () => {
  it("defines only the accepted event categories", () => {
    expect(ALERT_EVENTS).toEqual([
      "completion",
      "error",
      "question",
      "task-completion",
      "subagent-completion",
    ]);
  });

  it("builds payloads without prompt, task, or tool content", () => {
    const payload = buildAlertPayload("completion", "task-1", "completed");

    expect(payload).toEqual({
      event: "completion",
      id: "task-1",
      status: "completed",
    });
    expect(Object.keys(payload).sort()).toEqual(["event", "id", "status"]);
  });

  it("suppresses duplicate event/id alerts", async () => {
    const dispatcher = new AlertDispatcher();
    const notify = vi.fn(() => true);
    const payload = buildAlertPayload("task-completion", "task-1", "done");

    await expect(
      dispatcher.dispatch(payload, { platform: "linux", notify }),
    ).resolves.toBe("native");
    await expect(
      dispatcher.dispatch(payload, { platform: "linux", notify }),
    ).resolves.toBe("duplicate");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("uses Linux native delivery when available", async () => {
    const fallback = vi.fn();
    await expect(
      deliverAlert(buildAlertPayload("completion"), {
        platform: "linux",
        notify: () => true,
        fallback,
      }),
    ).resolves.toBe("native");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back to the terminal when native delivery fails", async () => {
    const fallback = vi.fn();
    await expect(
      deliverAlert(buildAlertPayload("error"), {
        platform: "linux",
        notify: () => false,
        fallback,
      }),
    ).resolves.toBe("fallback");
    expect(fallback).toHaveBeenCalledWith({ event: "error" });
  });

  it("does not claim native delivery on non-Linux platforms", async () => {
    const notify = vi.fn(() => true);
    const fallback = vi.fn();
    await expect(
      deliverAlert(buildAlertPayload("question"), {
        platform: "darwin",
        notify,
        fallback,
      }),
    ).resolves.toBe("fallback");
    expect(notify).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledOnce();
  });
});
