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
});
