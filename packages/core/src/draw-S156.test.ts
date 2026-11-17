import { describe, expect, it } from "vitest";
import { ALERT_EVENTS } from "./alerts.js";

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
});
