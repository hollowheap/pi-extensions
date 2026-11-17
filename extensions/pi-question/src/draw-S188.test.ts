import { describe, expect, it, vi } from "vitest";
import { askQuestions } from "./index.js";

describe("S188 partial answers on cancellation", () => {
  it("retains earlier answers and marks the flow cancelled when a later prompt is dismissed", async () => {
    const select = vi
      .fn()
      .mockResolvedValueOnce("Option A")
      .mockResolvedValueOnce(undefined);
    const ctx = {
      ui: { select, input: vi.fn(), custom: vi.fn() },
      hasUI: true,
      mode: "tui",
    };

    const answers = await askQuestions(
      [
        { mode: "single", prompt: "First?", options: ["Option A", "Option B"] },
        { mode: "single", prompt: "Second?", options: ["X", "Y"] },
      ],
      ctx as never,
    );

    expect(answers?.cancelled).toBe(true);
    expect(answers?.[0]).toEqual({ mode: "single", value: "Option A" });
    expect(select).toHaveBeenCalledTimes(2);
  });
});
