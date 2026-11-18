import { describe, expect, it, vi } from "vitest";
import { askQuestion, createQuestionTool } from "./index.js";
import { DONE_LABEL } from "./questions.js";

function textOf(result: { content: unknown[] }): string {
  return (result.content[0] as { text?: string })?.text ?? "";
}

describe("S44: interactive gating and TUI-versus-RPC dialog paths", () => {
  it("opens no dialog in print/json or without hasUI, then picks custom for TUI and select for RPC", async () => {
    const pi = { appendEntry: vi.fn() };
    const questionTool = createQuestionTool(pi as never);
    for (const mode of ["print", "json"]) {
      const ui = { select: vi.fn(), input: vi.fn(), custom: vi.fn() };
      const result = (await questionTool.execute(
        "c1",
        { prompt: "Pick", options: ["A"] },
        undefined,
        undefined,
        { hasUI: true, mode, ui } as never,
      )) as { content: unknown[] };
      expect(textOf(result)).toContain("requires an interactive session");
      expect(ui.select).not.toHaveBeenCalled();
      expect(ui.custom).not.toHaveBeenCalled();
    }
    expect(pi.appendEntry).not.toHaveBeenCalled();

    const noUi = {
      hasUI: false,
      mode: "tui",
      ui: { select: vi.fn(), custom: vi.fn() },
    };
    const noUiResult = (await questionTool.execute(
      "c2",
      { prompt: "Pick", options: ["A"] },
      undefined,
      undefined,
      noUi as never,
    )) as { content: unknown[] };
    expect(textOf(noUiResult)).toContain("requires an interactive session");
    expect(noUi.ui.select).not.toHaveBeenCalled();

    const custom = vi.fn().mockResolvedValue({
      selected: [],
      writeIn: undefined,
      cancelled: false,
    });
    const tuiUi = { select: vi.fn(), input: vi.fn(), custom };
    const tuiAnswer = await askQuestion(
      { prompt: "Many", mode: "multi", options: ["A"], page: 1 },
      { hasUI: true, mode: "tui", ui: tuiUi } as never,
    );
    expect(custom).toHaveBeenCalled();
    expect(tuiUi.select).not.toHaveBeenCalled();
    expect(tuiAnswer).toEqual({
      mode: "multi",
      selected: [],
      writeIn: undefined,
    });

    const rpcSelect = vi.fn().mockResolvedValue(DONE_LABEL);
    await askQuestion(
      { prompt: "Many", mode: "multi", options: ["A"], page: 1 },
      { hasUI: true, mode: "rpc", ui: { select: rpcSelect } } as never,
    );
    expect(rpcSelect).toHaveBeenCalled();
  });
});

describe("abort, empty input, and details seams", () => {
  it("S44 C02: an aborted dialog resolves to no answer", async () => {
    const controller = new AbortController();
    const ctx = {
      hasUI: true,
      mode: "rpc",
      ui: {
        select: vi
          .fn()
          .mockRejectedValue(new DOMException("aborted", "AbortError")),
      },
    };
    await expect(
      askQuestion(
        { prompt: "Pick", mode: "single", options: ["A"], page: 1 },
        ctx as never,
        { signal: controller.signal },
      ),
    ).resolves.toBeUndefined();
    expect(ctx.ui.select).toHaveBeenCalledTimes(1);
  });

  it("S44 C03: a tool call with no prompt reports an error", async () => {
    const pi = { appendEntry: vi.fn() };
    const questionTool = createQuestionTool(pi as never);
    const ui = { select: vi.fn(), input: vi.fn(), custom: vi.fn() };
    const result = (await questionTool.execute("c2", {}, undefined, undefined, {
      hasUI: true,
      mode: "rpc",
      ui,
    } as never)) as { content: unknown[] };
    expect(textOf(result)).toBe("Error: No question prompt provided.");
    expect(pi.appendEntry).not.toHaveBeenCalled();
    expect(ui.select).not.toHaveBeenCalled();
  });

  it("S44 C04: non-interactive execution returns a no-ui details contract", async () => {
    const pi = { appendEntry: vi.fn() };
    const questionTool = createQuestionTool(pi as never);
    const result = (await questionTool.execute(
      "c3",
      { prompt: "Pick", options: ["A"] },
      undefined,
      undefined,
      { hasUI: true, mode: "print", ui: {} } as never,
    )) as { details: unknown };
    expect(result.details).toEqual({
      cancelled: true,
      answers: [],
      reason: "no-ui",
    });
  });
});
