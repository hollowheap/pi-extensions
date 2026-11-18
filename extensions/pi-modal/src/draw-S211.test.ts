import { describe, expect, it, vi } from "vitest";
import { ModalEditor } from "./editor.js";
import { resolveEffectiveKeymaps } from "./keymap.js";
import { formatVimKeys } from "./vimkeys.js";

const MOTIONS = [
  "w",
  "b",
  "e",
  "0",
  "$",
  "gg",
  "G",
  "dd",
  "yy",
  "p",
  "u",
  "\x12",
];

function createEditor(text: string): ModalEditor {
  const tui = {
    requestRender: vi.fn(),
    terminal: { rows: 24, columns: 80, write: vi.fn() },
  };
  const theme = {
    borderColor: (value: string) => value,
    selectList: {
      selectedPrefix: (value: string) => value,
      selectedText: (value: string) => value,
      description: (value: string) => value,
      scrollInfo: (value: string) => value,
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

describe("modal vim bindings", () => {
  it("S211 C01: binds common motions and operators in normal mode", () => {
    const normal = resolveEffectiveKeymaps().normal;
    for (const key of MOTIONS) {
      expect(Object.hasOwn(normal, key)).toBe(true);
    }
  });

  it("S211 C02: lists the same motions and operators in the keybind reference", () => {
    const reference = formatVimKeys();
    for (const key of MOTIONS) {
      expect(reference).toContain(key);
    }
  });

  it("S211 C03: dd deletes and yanks the current line", () => {
    const editor = createEditor("first\nsecond\nthird");
    editor.handleInput("k");
    editor.handleInput("k");
    editor.handleInput("j");
    editor.handleInput("d");
    editor.handleInput("d");
    expect(editor.getText()).toBe("first\nthird");
    expect(editor.getYankedText()).toBe("second");
  });

  it("S211 C04: yy yanks the current line without changing the buffer", () => {
    const editor = createEditor("first\nsecond");
    editor.handleInput("k");
    editor.handleInput("y");
    editor.handleInput("y");
    expect(editor.getYankedText()).toBe("first");
    expect(editor.getText()).toBe("first\nsecond");
  });

  it("S211 C05: gg moves the cursor to the start of the line", () => {
    const editor = createEditor("hello");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("l");
    expect(editor.getCursor().col).toBeGreaterThan(0);
    editor.handleInput("g");
    editor.handleInput("g");
    expect(editor.getCursor().col).toBe(0);
  });

  it("S211 C06: p pastes yanked text at the cursor", () => {
    const editor = createEditor("abc");
    editor.handleInput("0");
    editor.handleInput("v");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("y");
    expect(editor.getYankedText()).toBe("abc");
    editor.handleInput("0");
    editor.handleInput("p");
    expect(editor.getText()).toBe("abcabc");
  });
});
