import { describe, expect, it, vi } from "vitest";
import { askSingleQuestion } from "../src/index.js";
import { WRITE_IN_LABEL } from "../src/questions.js";

describe("TUI single-select offers a write-in row then asks for text", () => {
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

describe("option, cap, and draft seams", () => {
  it("picking a regular option skips the write-in input", async () => {
    const select = vi.fn().mockResolvedValue("A");
    const input = vi.fn();
    const ctx = { hasUI: true, mode: "tui", ui: { select, input } };
    const answer = await askSingleQuestion(
      { prompt: "Pick", mode: "single", options: ["A", "B"], page: 1 },
      ctx as never,
    );
    expect(answer).toEqual({ mode: "single", value: "A" });
    expect(input).not.toHaveBeenCalled();
  });

  it("a write-in answer is capped at 500 characters", async () => {
    const ctx = {
      hasUI: true,
      mode: "tui",
      ui: {
        select: vi.fn().mockResolvedValue(WRITE_IN_LABEL),
        input: vi.fn().mockResolvedValue("x".repeat(600)),
      },
    };
    const answer = await askSingleQuestion(
      { prompt: "Pick", mode: "single", options: ["A"], page: 1 },
      ctx as never,
    );
    expect(answer).toEqual({ mode: "single", value: "x".repeat(500) });
  });

  it("the editor and draft stay in place during the dialog", async () => {
    const component = { type: "original-editor" };
    const getEditorComponent = vi.fn(() => component);
    const setEditorComponent = vi.fn();
    const getEditorText = vi.fn(() => "draft text");
    const setEditorText = vi.fn();
    const ctx = {
      hasUI: true,
      mode: "tui",
      ui: {
        select: vi.fn().mockResolvedValue("A"),
        getEditorComponent,
        setEditorComponent,
        getEditorText,
        setEditorText,
      },
    };

    await askSingleQuestion(
      { prompt: "Pick", mode: "single", options: ["A"], page: 1 },
      ctx as never,
    );

    expect(setEditorComponent).not.toHaveBeenCalled();
    expect(setEditorText).not.toHaveBeenCalled();
  });
});
