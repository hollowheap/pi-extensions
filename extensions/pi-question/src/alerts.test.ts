import { describe, expect, it, vi } from "vitest";
import { deliverQuestionAlert } from "./alerts.js";

describe("question alerts", () => {
  it("delivers a payload containing only the question event and status", async () => {
    const notify = vi.fn(() => true);
    await deliverQuestionAlert({ platform: "linux", notify });

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      event: "question",
      status: "asked",
    });
  });

  it("falls back without throwing", async () => {
    const fallback = vi.fn();
    await expect(
      deliverQuestionAlert({ platform: "darwin", fallback }),
    ).resolves.toBeUndefined();
    expect(fallback).toHaveBeenCalledWith({
      event: "question",
      status: "asked",
    });
  });
});
