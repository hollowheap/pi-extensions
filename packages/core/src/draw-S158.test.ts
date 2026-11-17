import { describe, expect, it } from "vitest";
import { buildAlertPayload } from "./alerts.js";

describe("S158 alert payload privacy", () => {
  it("builds a payload containing only event, id, and status identifiers", () => {
    const payload = buildAlertPayload("completion", "task-1", "completed", {
      prompt: "secret prompt",
      task: "secret task",
      toolOutput: "secret output",
    } as never);

    expect(payload).toEqual({
      event: "completion",
      id: "task-1",
      status: "completed",
    });
    expect(Object.keys(payload).sort()).toEqual(["event", "id", "status"]);
  });
});
