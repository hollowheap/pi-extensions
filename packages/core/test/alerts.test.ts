import { describe, expect, it, vi } from "vitest";
import {
  ALERT_EVENTS,
  AlertDispatcher,
  CompletionAlertTracker,
  buildAlertPayload,
  deliverAlert,
} from "../src/alerts.js";

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

  it("uses terminal delivery on unsupported platforms", async () => {
    const notify = vi.fn(() => true);
    const fallback = vi.fn();
    await expect(
      deliverAlert(buildAlertPayload("question"), {
        platform: "freebsd",
        notify,
        fallback,
      }),
    ).resolves.toBe("fallback");
    expect(notify).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledOnce();
  });
});

describe("CompletionAlertTracker", () => {
  it("emits once after a seeded item enters a terminal status", async () => {
    const tracker = new CompletionAlertTracker({ topic: "task-completion" });
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

  it("ignores items first observed in a terminal state", async () => {
    const tracker = new CompletionAlertTracker({
      topic: "subagent-completion",
    });
    const notify = vi.fn(() => true);

    await tracker.observe([{ id: "sub-1", status: "failed" }], {
      platform: "linux",
      notify,
    });

    expect(notify).not.toHaveBeenCalled();
  });

  it("supports custom terminalStatuses and swallows delivery errors", async () => {
    const tracker = new CompletionAlertTracker({
      topic: "completion",
      terminalStatuses: ["done"],
    });
    const notify = vi.fn(() => {
      throw new Error("notifier failed");
    });
    tracker.seed({ id: "job-1", status: "running" });

    await expect(
      tracker.observe([{ id: "job-1", status: "completed" }], {
        platform: "linux",
        notify,
      }),
    ).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();

    await expect(
      tracker.observe([{ id: "job-1", status: "done" }], {
        platform: "linux",
        notify,
      }),
    ).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      event: "completion",
      id: "job-1",
      status: "done",
    });
  });
});
