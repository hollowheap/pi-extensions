import { describe, expect, it, vi } from "vitest";
import { ModalEditor } from "./editor.js";

function createEditor(initialText: string) {
  const tui = { requestRender: vi.fn() };
  const theme = {
    borderColor: (value: string) => value,
    selectList: {
      selectedPrefix: (value: string) => value,
      selectedText: (value: string) => value,
      description: (value: string) => value,
      scrollInfo: (value: string) => value,
    },
  };
  const keybindings = { matches: vi.fn(() => false) };
  const editor = new ModalEditor(
    tui as never,
    theme as never,
    keybindings as never,
    { initialMode: "normal" },
  );
  editor.setText(initialText);
  return editor;
}

describe("S176 grapheme-aware visual yank", () => {
  it("yanks a whole emoji grapheme with visual y", () => {
    const editor = createEditor("👍🏽 world");

    editor.handleInput("0");
    editor.handleInput("v");
    editor.handleInput("y");

    expect(editor.getYankedText()).toBe("👍🏽");
    expect(editor.getMode()).toBe("normal");
  });
});
