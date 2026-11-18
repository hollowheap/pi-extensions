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

  it("S176 C02: visual x deletes the whole grapheme from the buffer", () => {
    const editor = createEditor("👍🏽 world");

    editor.handleInput("0");
    editor.handleInput("v");
    editor.handleInput("x");

    expect(editor.getText()).toBe(" world");
    expect(editor.getYankedText()).toBe("👍🏽");
  });

  it("S176 C03: Esc clears a visual selection without mutating the buffer", () => {
    const editor = createEditor("👍🏽 world");

    editor.handleInput("0");
    editor.handleInput("v");
    expect(editor.getSelectionAnchor()).not.toBeNull();

    editor.handleInput("\x1b");

    expect(editor.getMode()).toBe("normal");
    expect(editor.getSelectionAnchor()).toBeNull();
    expect(editor.getText()).toBe("👍🏽 world");
  });

  it("S176 C04: visual c deletes the grapheme and enters insert mode", () => {
    const editor = createEditor("👍🏽 world");

    editor.handleInput("0");
    editor.handleInput("v");
    editor.handleInput("c");

    expect(editor.getText()).toBe(" world");
    expect(editor.getMode()).toBe("insert");
  });
});
