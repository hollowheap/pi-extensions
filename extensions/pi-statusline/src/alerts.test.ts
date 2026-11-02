import { describe, expect, it, vi } from "vitest";
import { deliverAgentCompletionAlert } from "./alerts.js";

describe("agent completion alerts", () => {
  it("delivers a payload containing only completion and settled status", async () => {
    const notify = vi.fn(() => true);
    await deliverAgentCompletionAlert({ platform: "linux", notify });

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      event: "completion",
      status: "settled",
    });
  });

  it("falls back without throwing", async () => {
    const fallback = vi.fn();
    await expect(
      deliverAgentCompletionAlert({ platform: "darwin", fallback }),
    ).resolves.toBeUndefined();
    expect(fallback).toHaveBeenCalledWith({
      event: "completion",
      status: "settled",
    });
  });
});
