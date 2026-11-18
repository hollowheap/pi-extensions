import { describe, expect, it } from "vitest";
import { ALERT_EVENTS, AlertDispatcher, buildAlertPayload } from "./alerts.js";

describe("S156 alert event contract", () => {
  it("exposes the five alert categories and keeps permission/ask in-terminal", () => {
    expect(ALERT_EVENTS).toEqual([
      "completion",
      "error",
      "question",
      "task-completion",
      "subagent-completion",
    ]);
    expect(ALERT_EVENTS).not.toContain("permission");
    expect(ALERT_EVENTS).not.toContain("ask");
  });

  it("S156 C02: in-terminal events are rejected as alert payload events", () => {
    expect(() => buildAlertPayload("permission" as never)).toThrow(
      /unknown alert event: permission/,
    );
    expect(() => buildAlertPayload("ask" as never)).toThrow(
      /unknown alert event: ask/,
    );
  });

  it("S156 C03: every exported event is accepted by the payload builder", () => {
    for (const event of ALERT_EVENTS) {
      expect(buildAlertPayload(event)).toEqual({ event });
    }
  });

  it("S156 C04: dispatch deduplicates by event and id, not by event alone", async () => {
    const delivered: string[] = [];
    const dispatcher = new AlertDispatcher();
    const delivery = {
      platform: "linux" as const,
      notify: (payload: { event: string; id?: string }) => {
        delivered.push(`${payload.event}:${payload.id ?? ""}`);
        return true;
      },
    };

    await dispatcher.dispatch(buildAlertPayload("completion", "a"), delivery);
    await dispatcher.dispatch(buildAlertPayload("completion", "a"), delivery);
    await dispatcher.dispatch(buildAlertPayload("completion", "b"), delivery);

    expect(delivered).toEqual(["completion:a", "completion:b"]);
  });
});
