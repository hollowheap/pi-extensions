import { describe, expect, it, vi } from "vitest";
import { askQuestion, askQuestions } from "./index.js";
import { DONE_LABEL, WRITE_IN_LABEL } from "./questions.js";

describe("S43: RPC uses select-based single and toggle-loop multi dialogs", () => {
  it("supports single select, a select toggle loop with Done, zero selections, and cancellation", async () => {
    const singleSelect = vi.fn().mockResolvedValue("A");
    const singleCtx = {
      hasUI: true,
      mode: "rpc",
      ui: { select: singleSelect },
    };
    await expect(
      askQuestion(
        { prompt: "Pick", mode: "single", options: ["A", "B"], page: 1 },
        singleCtx as never,
      ),
    ).resolves.toEqual({ mode: "single", value: "A" });
    expect(singleSelect).toHaveBeenCalledWith(
      "Pick",
      ["A", "B", WRITE_IN_LABEL],
      expect.anything(),
    );

    const multiSelect = vi
      .fn()
      .mockResolvedValueOnce("[ ] A")
      .mockResolvedValueOnce(DONE_LABEL);
    const multiCtx = {
      hasUI: true,
      mode: "rpc",
      ui: { select: multiSelect, input: vi.fn() },
    };
    await expect(
      askQuestion(
        { prompt: "Many", mode: "multi", options: ["A", "B"], page: 1 },
        multiCtx as never,
      ),
    ).resolves.toEqual({ mode: "multi", selected: ["A"], writeIn: undefined });
    expect(multiSelect.mock.calls[0][1]).toEqual(
      expect.arrayContaining(["[ ] A", WRITE_IN_LABEL, DONE_LABEL]),
    );
    expect(multiSelect.mock.calls[1][1]).toContain("[x] A");

    const zeroCtx = {
      hasUI: true,
      mode: "rpc",
      ui: { select: vi.fn().mockResolvedValue(DONE_LABEL), input: vi.fn() },
    };
    await expect(
      askQuestion(
        { prompt: "Many", mode: "multi", options: ["A"], page: 1 },
        zeroCtx as never,
      ),
    ).resolves.toEqual({ mode: "multi", selected: [], writeIn: undefined });

    const cancelCtx = {
      hasUI: true,
      mode: "rpc",
      ui: { select: vi.fn().mockResolvedValue(undefined) },
    };
    const cancelled = await askQuestions(
      [{ prompt: "Q", mode: "single", options: ["A"], page: 1 }],
      cancelCtx as never,
    );
    expect(cancelled?.cancelled).toBe(true);
  });
});

describe("write-in and branching seams", () => {
  it("S43 C02: an RPC single write-in returns the typed value", async () => {
    const ctx = {
      hasUI: true,
      mode: "rpc",
      ui: {
        select: vi.fn().mockResolvedValue(WRITE_IN_LABEL),
        input: vi.fn().mockResolvedValue("custom"),
      },
    };
    await expect(
      askQuestion(
        { prompt: "Pick", mode: "single", options: ["A"], page: 1 },
        ctx as never,
      ),
    ).resolves.toEqual({ mode: "single", value: "custom" });
    expect(ctx.ui.input).toHaveBeenCalled();
  });

  it("S43 C03: an RPC multi write-in is capped at 500 characters", async () => {
    const ctx = {
      hasUI: true,
      mode: "rpc",
      ui: {
        select: vi
          .fn()
          .mockResolvedValueOnce(WRITE_IN_LABEL)
          .mockResolvedValueOnce(DONE_LABEL),
        input: vi.fn().mockResolvedValue("x".repeat(600)),
      },
    };
    await expect(
      askQuestion(
        { prompt: "Many", mode: "multi", options: ["A"], page: 1 },
        ctx as never,
      ),
    ).resolves.toEqual({
      mode: "multi",
      selected: [],
      writeIn: "x".repeat(500),
    });
  });

  it("S43 C04: a condition that evaluates false skips its question", async () => {
    const select = vi.fn().mockResolvedValue("A");
    const ctx = { hasUI: true, mode: "rpc", ui: { select } };
    const answers = await askQuestions(
      [
        { prompt: "Q1", mode: "single", options: ["A", "B"], page: 1 },
        {
          prompt: "Q2",
          mode: "single",
          options: ["A"],
          page: 1,
          condition: "answer1 == 'Yes'",
        },
      ],
      ctx as never,
    );
    expect(select).toHaveBeenCalledTimes(1);
    expect(answers?.[0]).toEqual({ mode: "single", value: "A" });
    expect(answers?.[1]).toBeUndefined();
    expect(answers?.cancelled).toBeUndefined();
  });
});
