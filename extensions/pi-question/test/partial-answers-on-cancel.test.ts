import { describe, expect, it, vi } from "vitest";
import { askQuestions } from "../src/index.js";

describe("partial answers on cancellation", () => {
  it("retains earlier answers and marks the flow cancelled when a later prompt is dismissed", async () => {
    const select = vi
      .fn()
      .mockResolvedValueOnce("Option A")
      .mockResolvedValueOnce(undefined);
    const ctx = {
      ui: { select, input: vi.fn(), custom: vi.fn() },
      hasUI: true,
      mode: "rpc",
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

  it("an empty question list returns an empty, uncancelled result", async () => {
    const ctx = {
      ui: { select: vi.fn(), input: vi.fn(), custom: vi.fn() },
      hasUI: true,
      mode: "rpc",
    };
    const answers = await askQuestions([], ctx as never);
    expect(answers).toEqual([]);
    expect(answers?.cancelled).toBeUndefined();
  });

  it("dismissing the first prompt stops before the second", async () => {
    const select = vi.fn().mockResolvedValueOnce(undefined);
    const ctx = {
      ui: { select, input: vi.fn(), custom: vi.fn() },
      hasUI: true,
      mode: "rpc",
    };
    const answers = await askQuestions(
      [
        { mode: "single", prompt: "First?", options: ["A"] },
        { mode: "single", prompt: "Second?", options: ["X"] },
      ],
      ctx as never,
    );
    expect(answers?.cancelled).toBe(true);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("outside TUI mode a completed flow returns answers without review", async () => {
    const select = vi.fn().mockResolvedValue("Option A");
    const custom = vi.fn();
    const ctx = {
      ui: { select, input: vi.fn(), custom },
      hasUI: true,
      mode: "print",
    };
    const answers = await askQuestions(
      [{ mode: "single", prompt: "Pick?", options: ["Option A"] }],
      ctx as never,
    );
    expect(answers?.[0]).toEqual({ mode: "single", value: "Option A" });
    expect(answers?.cancelled).toBeUndefined();
    expect(custom).not.toHaveBeenCalled();
  });
});
