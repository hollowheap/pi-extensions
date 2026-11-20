import { describe, expect, it, vi } from "vitest";
import { ModalEditor } from "../src/editor.js";

function stripCursorMarkers(line: string): string {
  let result = "";
  for (let index = 0; index < line.length; index++) {
    if (line.startsWith("\x1b_pi:", index)) {
      const end = line.indexOf("\x07", index);
      if (end !== -1) {
        index = end;
        continue;
      }
    }
    result += line[index];
  }
  return result;
}

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

describe("visual selection yank and cut", () => {
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

  it("escape in visual mode cancels the selection and keeps the buffer", () => {
    const editor = createEditor("foo bar baz");
    editor.handleInput("0");
    editor.handleInput("v");
    editor.handleInput("l");
    expect(editor.getSelection()?.text).toBe("fo");

    editor.handleInput("\x1b");
    expect(editor.getMode()).toBe("normal");
    expect(editor.getSelection()).toBeNull();
    expect(editor.getText()).toBe("foo bar baz");
  });

  it("change cuts the selection and enters insert mode", () => {
    const editor = createEditor("foo bar baz");
    editor.handleInput("0");
    editor.handleInput("v");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("c");
    expect(editor.getMode()).toBe("insert");
    expect(editor.getText()).toBe(" bar baz");
    expect(editor.getYankedText()).toBe("foo");
  });

  it("the selection exposes ordered start and end positions", () => {
    const editor = createEditor("foo bar baz");
    editor.handleInput("0");
    editor.handleInput("v");
    editor.handleInput("l");
    editor.handleInput("l");
    const selection = editor.getSelection();
    expect(selection).not.toBeNull();
    expect(selection?.text).toBe("foo");
    expect(selection?.start).toEqual({ line: 0, col: 0 });
    expect(selection?.end).toEqual({ line: 0, col: 2 });
  });

  it("highlights visual selection across wrapped lines", () => {
    const editor = createEditor("alpha beta gamma delta");
    editor.handleInput("0");
    editor.handleInput("v");
    for (let i = 0; i < 15; i++) editor.handleInput("l");
    const rows = editor.render(16).map(stripCursorMarkers);
    const highlightedRows = rows.filter((row) => row.includes("\x1b[7m"));
    expect(highlightedRows.length).toBeGreaterThanOrEqual(2);
    expect(highlightedRows[0]).toContain("\x1b[7malpha beta\x1b[27m");
    expect(highlightedRows[1]).toContain("\x1b[7mgamma\x1b[27m");
  });

  it("highlights wide CJK characters and surrogate-pair emojis without splitting graphemes", () => {
    const cjkEditor = createEditor("你好world");
    cjkEditor.handleInput("0");
    cjkEditor.handleInput("v");
    cjkEditor.handleInput("l");
    const cjkRows = cjkEditor.render(24).map(stripCursorMarkers);
    expect(cjkRows[1]).toContain("\x1b[7m你好\x1b[27m");
    expect(cjkRows[1]).toContain("world");

    const emojiEditor = createEditor("😀abc");
    emojiEditor.handleInput("0");
    emojiEditor.handleInput("v");
    emojiEditor.handleInput("l");
    const emojiRows = emojiEditor.render(24).map(stripCursorMarkers);
    expect(emojiRows[1]).toContain("\x1b[7m😀a\x1b[27m");
  });
});
