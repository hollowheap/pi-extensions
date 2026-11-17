import { describe, expect, it, vi } from "vitest";
import { ModalEditor } from "./editor.js";

function createEditor(text: string) {
  const tui = {
    requestRender: vi.fn(),
    terminal: { rows: 24, columns: 80, write: vi.fn() },
  };
  const theme = {
    borderColor: (s: string) => s,
    selectList: {
      selectedPrefix: (s: string) => s,
      selectedText: (s: string) => s,
      description: (s: string) => s,
      scrollInfo: (s: string) => s,
    },
  };
  const editor = new ModalEditor(
    tui as never,
    theme as never,
    { matches: vi.fn(() => false) } as never,
    { initialMode: "normal" },
  );
  editor.setText(text);
  return editor;
}

describe("S118 visual selection yank and cut", () => {
  it("yanks a highlighted selection without mutating the buffer", () => {
    const editor = createEditor("foo bar baz");
    editor.handleInput("0");
    editor.handleInput("v");
    editor.handleInput("l");
    editor.handleInput("l");
    expect(editor.getSelection()?.text).toBe("foo");

    editor.handleInput("y");
    expect(editor.getMode()).toBe("normal");
    expect(editor.getYankedText()).toBe("foo");
    expect(editor.getText()).toBe("foo bar baz");
    expect(editor.getSelection()).toBeNull();
  });

  it("cuts a highlighted selection with d and returns to normal mode", () => {
    const editor = createEditor("foo bar baz");
    editor.handleInput("0");
    editor.handleInput("v");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("d");
    expect(editor.getMode()).toBe("normal");
    expect(editor.getText()).toBe("bar baz");
  });
});
