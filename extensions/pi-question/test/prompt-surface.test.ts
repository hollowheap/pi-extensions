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
    expect(c.ui.custom).toHaveBeenCalled();
  });
});
