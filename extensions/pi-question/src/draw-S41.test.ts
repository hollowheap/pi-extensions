import { describe, expect, it, vi } from "vitest";
import { askSingleQuestion } from "./index.js";
import { WRITE_IN_LABEL } from "./questions.js";

describe("S41: TUI single-select offers a write-in row then asks for text", () => {
  it("uses select with the write-in row and falls back to input; cancelling select cancels the answer", async () => {
    const select = vi.fn().mockResolvedValue(WRITE_IN_LABEL);
    const input = vi.fn().mockResolvedValue("My custom");
    const ctx = { hasUI: true, mode: "tui", ui: { select, input } };

    const answer = await askSingleQuestion(
      { prompt: "Pick", mode: "single", options: ["A", "B"], page: 1 },
      ctx as never,
    );

    expect(select).toHaveBeenCalledWith(
      "Pick",
      ["A", "B", WRITE_IN_LABEL],
      expect.anything(),
    );
    expect(input).toHaveBeenCalled();
    expect(answer).toEqual({ mode: "single", value: "My custom" });

    const cancelCtx = {
      hasUI: true,
      mode: "tui",
      ui: { select: vi.fn().mockResolvedValue(undefined), input: vi.fn() },
    };
    await expect(
      askSingleQuestion(
        { prompt: "Pick", mode: "single", options: ["A"], page: 1 },
        cancelCtx as never,
      ),
    ).resolves.toBeUndefined();
  });
});
