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

describe("S125 search and substitution", () => {
  it("finds matches with n/N navigation and replaces across lines", () => {
    const editor = createEditor("one\ntwo\nthree");
    editor.handleInput("0");
    editor.handleInput("/");
    editor.handleInput("t");
    editor.handleInput("\r");
    expect(editor.getCursor()).toEqual({ line: 1, col: 0 });
    editor.handleInput("n");
    expect(editor.getCursor()).toEqual({ line: 2, col: 0 });
    editor.handleInput("N");
    expect(editor.getCursor()).toEqual({ line: 1, col: 0 });

    const substitution = createEditor("foo foo\nfoo");
    for (const key of ":%s/foo/bar/g") substitution.handleInput(key);
    substitution.handleInput("\r");
    expect(substitution.getText()).toBe("bar bar\nbar");
  });

  it("S125 C02: forward search wraps past the last match", () => {
    const editor = createEditor("t\nt\nt");
    editor.handleInput("/");
    editor.handleInput("t");
    editor.handleInput("\r");
    const first = editor.getCursor();
    editor.handleInput("n");
    const second = editor.getCursor();
    editor.handleInput("n");
    const third = editor.getCursor();
    expect(new Set([first.line, second.line, third.line]).size).toBe(3);
    editor.handleInput("n");
    expect(editor.getCursor()).toEqual(first);
  });

  it("S125 C03: a substitution with an empty source leaves the buffer intact", () => {
    const editor = createEditor("foo\nfoo");
    editor.handleInput("0");
    for (const key of ":%s//bar/g") editor.handleInput(key);
    editor.handleInput("\r");
    expect(editor.getText()).toBe("foo\nfoo");
  });

  it("S125 C04: visual mode exposes the selected text to consumers", () => {
    const editor = createEditor("abc\ndef");
    editor.setMode("visual");
    (
      editor as unknown as { selectionAnchor: { line: number; col: number } }
    ).selectionAnchor = { line: 0, col: 0 };
    (
      editor as unknown as { moveCursorTo: (line: number, col: number) => void }
    ).moveCursorTo(1, 1);
    expect(editor.getMode()).toBe("visual");
    expect(editor.getSelection()?.text).toBe("abc\nde");
  });
});
