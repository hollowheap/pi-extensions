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
});
