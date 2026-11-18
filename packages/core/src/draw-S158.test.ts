import { describe, expect, it } from "vitest";
import { AlertDispatcher, buildAlertPayload } from "./alerts.js";

describe("S158 alert payload privacy", () => {
  it("builds a payload containing only event, id, and status identifiers", () => {
    const payload = buildAlertPayload("completion", "task-1", "completed");

    expect(payload).toEqual({
      event: "completion",
      id: "task-1",
      status: "completed",
    });
    expect(Object.keys(payload).sort()).toEqual(["event", "id", "status"]);
  });

  it("S158 C02: omitted identifiers are absent rather than empty keys", () => {
    const payload = buildAlertPayload("error");

    expect(Object.keys(payload)).toEqual(["event"]);
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("status");
  });

  it("S158 C03: defined-but-empty identifiers are preserved verbatim", () => {
    const payload = buildAlertPayload("error", "", "");

    expect(payload).toEqual({ event: "error", id: "", status: "" });
    expect(Object.keys(payload)).toEqual(["event", "id", "status"]);
  });

  it("S158 C04: dispatcher identity ignores status changes for the same id", async () => {
    const dispatcher = new AlertDispatcher();
    const delivery = { platform: "linux" as const, notify: () => true };

    expect(
      await dispatcher.dispatch(
        buildAlertPayload("error", "e-1", "open"),
        delivery,
      ),
    ).toBe("native");
    expect(
      await dispatcher.dispatch(
        buildAlertPayload("error", "e-1", "resolved"),
        delivery,
      ),
    ).toBe("duplicate");
  });
});
