import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModalEditor } from "./editor.js";
import extension from "./index.js";
import {
  DEFAULT_NORMAL_KEYS,
  loadModalConfig,
  resolveEffectiveKeymaps,
} from "./keymap.js";

const tmpDirs: string[] = [];
function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-modal-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  tmpDirs.length = 0;
});

function createMockEditor(config = {}, options: { initialText?: string } = {}) {
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
  const keybindings = {
    matches: vi.fn(() => false),
  };

  const editor = new ModalEditor(
    tui as never,
    theme as never,
    keybindings as never,
    config,
  );
  if (options.initialText) {
    editor.setText(options.initialText);
  }
  return { editor, tui, theme, keybindings };
}

describe("keymap config loading and resolution", () => {
  it("returns default config when modal.json does not exist", () => {
    const dir = createTempDir();
    const config = loadModalConfig(dir);
    expect(config.enabled).toBe(true);
    expect(config.initialMode).toBe("insert");
    expect(config.promptChar).toBe("❯");
    expect(config.keymaps?.normal).toEqual({});
  });

  it("loads single-character promptChar from modal.json and validates length", () => {
    const dir = createTempDir();
    writeFileSync(
      join(dir, "modal.json"),
      JSON.stringify({
        promptChar: "$",
      }),
    );
    const config = loadModalConfig(dir);
    expect(config.promptChar).toBe("$");

    writeFileSync(
      join(dir, "modal.json"),
      JSON.stringify({
        promptChar: ">>>",
      }),
    );
    const multiConfig = loadModalConfig(dir);
    expect(multiConfig.promptChar).toBe("❯");
  });

  it("loads user key overrides and initialMode from modal.json", () => {
    const dir = createTempDir();
    writeFileSync(
      join(dir, "modal.json"),
      JSON.stringify({
        enabled: true,
        initialMode: "normal",
        keymaps: {
          normal: {
            gh: "\x01",
            gl: "\x05",
          },
          insert: {
            jk: null,
          },
        },
      }),
    );
    const config = loadModalConfig(dir);
    expect(config.enabled).toBe(true);
    expect(config.initialMode).toBe("normal");
    expect(config.keymaps?.normal?.gh).toBe("\x01");
    expect(config.keymaps?.insert?.jk).toBeNull();
  });

  it("handles malformed modal.json gracefully", () => {
    const dir = createTempDir();
    writeFileSync(join(dir, "modal.json"), "invalid json content {{{");
    const config = loadModalConfig(dir);
    expect(config.enabled).toBe(true);
    expect(config.initialMode).toBe("insert");
  });

  it("merges custom keymaps on top of Vim defaults", () => {
    const effective = resolveEffectiveKeymaps({
      keymaps: {
        normal: {
          x: "\x08", // Remap x to backspace
          custom: "\x1b[A",
        },
      },
    });
    expect(effective.normal.h).toBe(DEFAULT_NORMAL_KEYS.h);
    expect(effective.normal.x).toBe("\x08");
    expect(effective.normal.custom).toBe("\x1b[A");
  });
});

describe("ModalEditor modal behavior", () => {
  it("initializes in configured mode and transitions between normal and insert", () => {
    const { editor } = createMockEditor({ initialMode: "insert" });
    expect(editor.getMode()).toBe("insert");

    // Escape in insert mode -> normal mode
    editor.handleInput("\x1b");
    expect(editor.getMode()).toBe("normal");

    // 'i' in normal mode -> insert mode
    editor.handleInput("i");
    expect(editor.getMode()).toBe("insert");

    // Escape back to normal mode
    editor.handleInput("\x1b");
    expect(editor.getMode()).toBe("normal");

    // 'a' in normal mode -> insert mode
    editor.handleInput("a");
    expect(editor.getMode()).toBe("insert");
  });

  it("transitions between normal and visual mode", () => {
    const { editor } = createMockEditor({ initialMode: "normal" });
    expect(editor.getMode()).toBe("normal");

    // 'v' in normal mode -> visual mode
    editor.handleInput("v");
    expect(editor.getMode()).toBe("visual");

    // 'v' in visual mode -> normal mode
    editor.handleInput("v");
    expect(editor.getMode()).toBe("normal");

    // 'v' into visual, then Escape -> normal mode
    editor.handleInput("v");
    expect(editor.getMode()).toBe("visual");
    editor.handleInput("\x1b");
    expect(editor.getMode()).toBe("normal");
  });

  it("visual actions (y, d, x) return to normal mode", () => {
    const { editor } = createMockEditor({ initialMode: "visual" });
    expect(editor.getMode()).toBe("visual");

    editor.handleInput("y");
    expect(editor.getMode()).toBe("normal");

    editor.setMode("visual");
    editor.handleInput("d");
    expect(editor.getMode()).toBe("normal");
  });

  it("highlights visual selection across movement keys in render()", () => {
    const { editor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "hello world" },
    );
    // Move to start of line
    editor.handleInput("0");
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });

    // Enter visual mode
    editor.handleInput("v");
    expect(editor.getMode()).toBe("visual");
    expect(editor.getSelectionAnchor()).toEqual({ line: 0, col: 0 });

    // Move cursor right by 4 characters (covering "hello")
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("l");
    expect(editor.getCursor()).toEqual({ line: 0, col: 4 });

    const selection = editor.getSelection();
    expect(selection).not.toBeNull();
    expect(selection?.text).toBe("hello");

    const lines = editor.render(80);
    expect(lines.length).toBeGreaterThan(2);
    // The rendered text content line should contain the highlighted text
    expect(
      lines.some((l) => l.includes("\x1b[7m") && l.includes("hello")),
    ).toBe(true);
  });

  it("yank (y) copies selection to clipboard without mutating buffer and returns to normal mode", () => {
    const { editor, tui } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "foo bar baz" },
    );
    editor.handleInput("0");
    editor.handleInput("v");
    editor.handleInput("l");
    editor.handleInput("l"); // selected "foo"

    editor.handleInput("y");
    expect(editor.getMode()).toBe("normal");
    expect(editor.getText()).toBe("foo bar baz");
    expect(editor.getYankedText()).toBe("foo");
    expect(editor.getSelection()).toBeNull();
    // OSC 52 base64 write for "foo" is Zm9v
    expect(tui.terminal.write).toHaveBeenCalledWith(
      expect.stringContaining("Zm9v"),
    );
  });

  it("cut (d and x) deletes selection, updates clipboard, and returns to normal mode", () => {
    const { editor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "foo bar baz" },
    );
    editor.handleInput("0");
    editor.handleInput("v");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("l"); // selected "foo " (col 0..3)

    editor.handleInput("d");
    expect(editor.getMode()).toBe("normal");
    expect(editor.getText()).toBe("bar baz");
    expect(editor.getYankedText()).toBe("foo ");
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });

    // Also test cut with 'x'
    editor.handleInput("v");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("l"); // selected "bar "
    editor.handleInput("x");
    expect(editor.getMode()).toBe("normal");
    expect(editor.getText()).toBe("baz");
    expect(editor.getYankedText()).toBe("bar ");
  });

  it("change (c) cuts selection, updates clipboard, and enters insert mode", () => {
    const { editor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "foo bar baz" },
    );
    editor.handleInput("0");
    editor.handleInput("v");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("l"); // "foo "

    editor.handleInput("c");
    expect(editor.getMode()).toBe("insert");
    expect(editor.getText()).toBe("bar baz");
    expect(editor.getYankedText()).toBe("foo ");

    // Type replacement text in insert mode
    editor.handleInput("q");
    editor.handleInput("u");
    editor.handleInput("x");
    editor.handleInput(" ");
    expect(editor.getText()).toBe("qux bar baz");
  });

  it("multi-line visual selection highlighting, yanking, and deletion", () => {
    const { editor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "first line\nsecond line" },
    );
    // Move up to line 0 and start of line
    editor.handleInput("k");
    editor.handleInput("0");
    editor.handleInput("w");
    editor.handleInput("l"); // col 6 ("line")
    expect(editor.getCursor()).toEqual({ line: 0, col: 6 });

    editor.handleInput("v");
    editor.handleInput("j"); // Move down to line 1
    const sel = editor.getSelection();
    expect(sel).not.toBeNull();
    expect(sel?.text).toBe("line\nsecond ");

    const lines = editor.render(80);
    // Both lines should include visual highlight
    const contentLines = lines.slice(1, -1);
    expect(
      contentLines.filter((l) => l.includes("\x1b[7m")).length,
    ).toBeGreaterThanOrEqual(2);

    editor.handleInput("d");
    expect(editor.getMode()).toBe("normal");
    expect(editor.getText()).toBe("first line");
    expect(editor.getYankedText()).toBe("line\nsecond ");
  });

  it("escape or v cancels visual selection without mutating buffer", () => {
    const { editor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "keep this safe" },
    );
    editor.handleInput("0");
    editor.handleInput("v");
    editor.handleInput("w");
    expect(editor.getMode()).toBe("visual");
    expect(editor.getSelection()).not.toBeNull();

    // Escape cancels
    editor.handleInput("\x1b");
    expect(editor.getMode()).toBe("normal");
    expect(editor.getSelection()).toBeNull();
    expect(editor.getText()).toBe("keep this safe");

    // 'v' toggles off
    editor.handleInput("v");
    expect(editor.getMode()).toBe("visual");
    editor.handleInput("v");
    expect(editor.getMode()).toBe("normal");
    expect(editor.getSelection()).toBeNull();
  });

  it("supports custom insert mode exit chords like jk", () => {
    const { editor } = createMockEditor({
      initialMode: "insert",
      keymaps: {
        insert: {
          jk: null,
        },
      },
    });
    expect(editor.getMode()).toBe("insert");
    editor.handleInput("jk");
    expect(editor.getMode()).toBe("normal");
  });

  it("does not switch to normal mode on escape when autocomplete is showing", () => {
    const { editor } = createMockEditor({ initialMode: "insert" });
    vi.spyOn(editor, "isShowingAutocomplete").mockReturnValue(true);

    editor.handleInput("\x1b");
    expect(editor.getMode()).toBe("insert");
  });

  it("executes string sequence override on i in normal mode instead of switching to insert", () => {
    const { editor } = createMockEditor({
      initialMode: "normal",
      keymaps: {
        normal: {
          i: "\x1b[C",
        },
      },
    });
    expect(editor.getMode()).toBe("normal");
    editor.handleInput("i");
    expect(editor.getMode()).toBe("normal");
  });

  it("renders the current mode badge on the bottom border", () => {
    const { editor } = createMockEditor({ initialMode: "normal" });
    let lines = editor.render(80);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[lines.length - 1]).toContain("NORMAL");

    editor.setMode("insert");
    lines = editor.render(80);
    expect(lines[lines.length - 1]).toContain("INSERT");

    editor.setMode("visual");
    lines = editor.render(80);
    expect(lines[lines.length - 1]).toContain("VISUAL");
  });

  it("decorates input with default promptChar ❯ and indents continuation lines", () => {
    const { editor } = createMockEditor({}, { initialText: "line1\nline2" });
    const lines = editor.render(80);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines[1]).toContain("❯ line1");
    expect(lines[2]).toContain("line2");
  });

  it("respects custom single-character promptChar in render", () => {
    const { editor } = createMockEditor(
      { promptChar: "$" },
      { initialText: "custom prompt" },
    );
    expect(editor.getPromptChar()).toBe("$");
    const lines = editor.render(80);
    expect(lines[1]).toContain("$ custom prompt");
  });
});

describe("extension registration", () => {
  it("registers editor component on session_start when UI is present", () => {
    const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
    const pi = {
      on: vi.fn((event: string, fn: (event: unknown, ctx: unknown) => void) => {
        handlers[event] = fn;
      }),
    };
    extension(pi as never);

    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));

    const ctx = {
      hasUI: true,
      ui: {
        setEditorComponent: vi.fn(),
      },
    };

    handlers.session_start?.({}, ctx);
    expect(ctx.ui.setEditorComponent).toHaveBeenCalledTimes(1);
  });

  it("bypasses registration when UI is missing", () => {
    const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
    const pi = {
      on: vi.fn((event: string, fn: (event: unknown, ctx: unknown) => void) => {
        handlers[event] = fn;
      }),
    };
    extension(pi as never);

    const ctx = {
      hasUI: false,
      ui: {},
    };

    handlers.session_start?.({}, ctx);
  });
});
