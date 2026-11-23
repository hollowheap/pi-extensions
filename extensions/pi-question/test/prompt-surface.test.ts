import { describe, expect, it, vi } from "vitest";
import { askQuestion } from "../src/index.js";

function ctx() {
  return {
    mode: "tui",
    hasUI: true,
    sessionManager: { getBranch: vi.fn(() => []) },
    ui: {
      custom: vi
        .fn()
        .mockImplementation((_factory: unknown, _opts: unknown) => {
          return Promise.resolve(undefined);
        }),
      select: vi.fn().mockResolvedValue(undefined),
      input: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn(),
      setEditorComponent: vi.fn(),
      getEditorComponent: vi.fn(),
    },
  };
}

describe("question prompt surface", () => {
  it("dialog leaves the prompt draft and editor in place", async () => {
    const c = ctx();
    const draft = "line one\nline two  ";
    (c.ui as { getDraft?: () => string }).getDraft = vi.fn(() => draft);
    await askQuestion(
      { prompt: "Pick", mode: "single", options: ["A"] } as never,
      c as never,
      undefined,
    );
    expect(c.ui.getEditorComponent).not.toHaveBeenCalled();
    expect(c.ui.setEditorComponent).not.toHaveBeenCalled();
  });

  it("selecting an option returns the single-choice answer", async () => {
    const c = ctx();
    c.mode = "rpc";
    c.ui.select = vi.fn().mockResolvedValue("A");
    const answer = await askQuestion(
      { prompt: "Pick", mode: "single", options: ["A", "B"] } as never,
      c as never,
    );
    expect(answer).toEqual({ mode: "single", value: "A" });
  });

  it("without a select surface the single question resolves undefined", async () => {
    const c = ctx();
    Reflect.deleteProperty(c.ui as object, "select");
    await expect(
      askQuestion(
        { prompt: "Pick", mode: "single", options: ["A"] } as never,
        c as never,
      ),
    ).resolves.toBeUndefined();
  });

  it("choosing the write-in row opens the free-text dialog", async () => {
    const c = ctx();
    c.ui.select = vi.fn().mockResolvedValue("Write-in answer");
    await askQuestion(
      { prompt: "Pick", mode: "single", options: ["A"] } as never,
      c as never,
    );
    expect(c.ui.custom).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ overlay: false }),
    );
  });

  it("returns to the option dialog after a dismissed write-in", async () => {
    const c = ctx();
    c.mode = "rpc";
    c.ui.select = vi
      .fn()
      .mockResolvedValueOnce("Write-in answer")
      .mockResolvedValueOnce("A");
    c.ui.input = vi.fn().mockResolvedValue(undefined);
    const answer = await askQuestion(
      { prompt: "Pick", mode: "single", options: ["A"] } as never,
      c as never,
      undefined,
    );
    expect(c.ui.select).toHaveBeenCalledTimes(2);
    expect(answer).toEqual({ mode: "single", value: "A" });
  });

  it("toggles focus with Shift+Left", async () => {
    const focus = vi.fn();
    const unfocus = vi.fn();
    let component: { handleInput(data: string): void } | undefined;
    let onHandle: ((handle: unknown) => void) | undefined;
    const custom = vi.fn(
      async (
        factory: (
          tui: unknown,
          theme: unknown,
          keys: unknown,
          done: (value: unknown) => void,
        ) => { handleInput(data: string): void },
        options: { onHandle?: (handle: unknown) => void },
      ) => {
        onHandle = options.onHandle;
        component = factory(
          { requestRender: vi.fn() },
          {
            fg: (_token: string, text: string) => text,
            bold: (t: string) => t,
          },
          {},
          () => {},
        );
        return undefined;
      },
    );
    const c = {
      mode: "tui",
      hasUI: true,
      sessionManager: { getBranch: vi.fn(() => []) },
      ui: { custom, select: vi.fn(), notify: vi.fn() },
    };
    await askQuestion(
      { prompt: "Free", mode: "free" } as never,
      c as never,
      undefined,
    );
    onHandle?.({ focus, unfocus });
    component?.handleInput("\x1b[1;2D");
    expect(unfocus).toHaveBeenCalledTimes(1);
    component?.handleInput("\x1b[1;2D");
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("reuses ctx.ui.input for free-text prompts in TUI when available", async () => {
    const input = vi.fn().mockResolvedValue("typed via host input");
    const custom = vi.fn();
    const c = { mode: "tui", hasUI: true, ui: { input, custom } };
    const answer = await askQuestion(
      { prompt: "Describe", mode: "free", options: [] } as never,
      c as never,
    );
    expect(answer).toEqual({ mode: "free", value: "typed via host input" });
    expect(input).toHaveBeenCalledWith("Describe", undefined, {
      signal: undefined,
      timeout: undefined,
    });
    expect(custom).not.toHaveBeenCalled();
  });

  it("uses centered popups for multi-select and free-text Editor fallback in TUI", async () => {
    const custom = vi.fn().mockResolvedValue(undefined);
    const c = { mode: "tui", hasUI: true, ui: { custom } };
    await askQuestion(
      { prompt: "Pick many", mode: "multi", options: ["A"] } as never,
      c as never,
    );
    expect(custom).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ overlay: false }),
    );
    custom.mockClear();
    await askQuestion(
      { prompt: "Free", mode: "free", options: [] } as never,
      c as never,
    );
    expect(custom).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ overlay: false }),
    );
  });

  it("falls back to ui.input in RPC mode even if editor is present", async () => {
    const editor = vi.fn();
    const input = vi.fn().mockResolvedValue("rpc text");
    const custom = vi.fn();
    const c = { mode: "rpc", hasUI: true, ui: { editor, input, custom } };
    const answer = await askQuestion(
      { prompt: "Describe", mode: "free", options: [] } as never,
      c as never,
    );
    expect(answer).toEqual({ mode: "free", value: "rpc text" });
    expect(input).toHaveBeenCalled();
    expect(editor).not.toHaveBeenCalled();
    expect(custom).not.toHaveBeenCalled();
  });

  it("bypasses ui.editor and uses cancellable showDialog when signal or timeoutMs is set", async () => {
    const editor = vi.fn().mockResolvedValue("should not be used");
    const custom = vi.fn(
      (
        factory: (
          tui: unknown,
          theme: unknown,
          keys: unknown,
          done: (value: unknown) => void,
        ) => unknown,
      ) =>
        new Promise((resolve) => {
          factory(
            { requestRender: vi.fn() },
            { fg: (_t: string, s: string) => s },
            {},
            resolve,
          );
        }),
    );
    const c = { mode: "tui", hasUI: true, ui: { editor, custom } };
    const abort = new AbortController();
    const pending = askQuestion(
      { prompt: "Describe", mode: "free", options: [] } as never,
      c as never,
      { signal: abort.signal },
    );
    await vi.waitFor(() => expect(custom).toHaveBeenCalledOnce());
    abort.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(editor).not.toHaveBeenCalled();

    custom.mockClear();
    custom.mockResolvedValueOnce("timed");
    await expect(
      askQuestion(
        { prompt: "Describe", mode: "free", options: [] } as never,
        c as never,
        { timeoutMs: 500 },
      ),
    ).resolves.toEqual({ mode: "free", value: "timed" });
    expect(editor).not.toHaveBeenCalled();
  });
});
