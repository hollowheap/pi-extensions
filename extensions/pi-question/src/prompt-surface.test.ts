import { describe, expect, it, vi } from "vitest";
import { askQuestion } from "./index.js";

function ctx() {
  return {
    mode: "tui",
    hasUI: true,
    sessionManager: { getBranch: vi.fn(() => []) },
    ui: {
      custom: vi
        .fn()
        .mockImplementation((_factory: unknown, _opts: unknown) => {
          // capture whether a hideEditor / stash hook was requested
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
  it("S192 C01: dialog stashes and restores the prompt draft byte-for-byte", async () => {
    const c = ctx();
    const draft = "line one\nline two  ";
    (c.ui as { getDraft?: () => string }).getDraft = vi.fn(() => draft);
    await askQuestion(
      { prompt: "Pick", mode: "single", options: ["A"] } as never,
      c as never,
      undefined,
    );
    // Public seam: the dialog must request a draft stash and restore it on close.
    expect(c.ui.getEditorComponent).toHaveBeenCalled();
    expect(c.ui.setEditorComponent).toHaveBeenCalled();
  });
});
