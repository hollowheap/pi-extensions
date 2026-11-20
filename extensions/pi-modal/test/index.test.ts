import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AssistantMessageComponent,
  type MarkdownTransformer,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import {
  type AutocompleteProvider,
  Loader,
  rgbColor,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  DEFAULT_TUI_CONFIG,
  getTuiConfigPath,
} from "@hollowheap/core/tui-config";
import {
  getActiveTuiConfig,
  resetActiveTuiConfig,
  setActiveTuiConfig,
} from "@hollowheap/tui/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModalEditor } from "../src/editor.js";
import extension from "../src/index.js";
import { DEFAULT_NORMAL_KEYS, resolveEffectiveKeymaps } from "../src/keymap.js";
import { loadModalConfig } from "../src/settings.js";

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

const tmpDirs: string[] = [];
function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-modal-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  resetActiveTuiConfig();
  Reflect.deleteProperty(process.env, "PI_CODING_AGENT_DIR");
  for (const dir of tmpDirs) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // ignore chmod cleanup errors
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  tmpDirs.length = 0;
});

function createMockEditor(
  config = {},
  options: {
    initialText?: string;
    borderColor?: (value: string) => string;
    modeTheme?: unknown;
  } = {},
) {
  const tui = {
    requestRender: vi.fn(),
    terminal: { rows: 24, columns: 80, write: vi.fn() },
  };
  const theme = {
    borderColor: options.borderColor ?? ((s: string) => s),
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
    undefined,
    options.modeTheme as never,
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
    const diagnostics: string[] = [];
    const config = loadModalConfig(dir, (message) => diagnostics.push(message));
    expect(config.enabled).toBe(true);
    expect(config.initialMode).toBe("insert");
    expect(diagnostics[0]).toContain("cannot read modal.json");
  });

  it("reports invalid initialMode and keymap values", () => {
    const dir = createTempDir();
    writeFileSync(
      join(dir, "modal.json"),
      JSON.stringify({
        initialMode: "visualx",
        keymaps: { normal: { bad: 42 } },
      }),
    );
    const diagnostics: string[] = [];
    const config = loadModalConfig(dir, (message) => diagnostics.push(message));
    expect(config.initialMode).toBe("insert");
    expect(config.keymaps?.normal).toEqual({});
    expect(diagnostics).toHaveLength(2);
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

  it("accepts kitty CSI-u printable keys for mode changes", () => {
    const { editor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "hello" },
    );

    editor.handleInput("\x1b[105u"); // i
    expect(editor.getMode()).toBe("insert");

    editor.handleInput("\x1b");
    editor.handleInput("\x1b[97u"); // a
    expect(editor.getMode()).toBe("insert");

    editor.handleInput("\x1b");
    editor.handleInput("\x1b[73;2u"); // shift+i
    expect(editor.getMode()).toBe("insert");
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });

    editor.handleInput("\x1b");
    editor.handleInput("\x1b[65;2u"); // shift+a
    expect(editor.getMode()).toBe("insert");
    expect(editor.getCursor()).toEqual({ line: 0, col: 5 });
  });

  it("changes text with C, cc, cw, and c$", () => {
    const { editor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "one two three" },
    );
    editor.handleInput("0");
    editor.handleInput("C");
    expect(editor.getText()).toBe("");
    expect(editor.getMode()).toBe("insert");

    const { editor: cc } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "one\ntwo" },
    );
    cc.handleInput("k");
    cc.handleInput("0");
    cc.handleInput("c");
    cc.handleInput("c");
    expect(cc.getText()).toBe("\ntwo");
    expect(cc.getMode()).toBe("insert");

    const { editor: cw } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "one two" },
    );
    cw.handleInput("0");
    cw.handleInput("c");
    cw.handleInput("w");
    expect(cw.getText()).toBe(" two");
    expect(cw.getMode()).toBe("insert");

    const { editor: cend } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "one two" },
    );
    cend.handleInput("0");
    cend.handleInput("w");
    cend.handleInput("c");
    cend.handleInput("$");
    expect(cend.getText()).toBe("one");
    expect(cend.getMode()).toBe("insert");
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

    const rendered = editor.render(80);
    const lines = rendered.map(stripCursorMarkers);
    expect(lines.length).toBeGreaterThan(2);
    // The rendered text content line should contain the highlighted text,
    // including the prompt when the selection starts at column zero.
    expect(
      lines.some((l) => l.includes("\x1b[7m") && l.includes("hello")),
    ).toBe(true);
    expect(lines[1]).toContain("\x1b[7mhello");
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

  it("bypasses insert-mode keymaps when autocomplete is showing", () => {
    const { editor } = createMockEditor({
      initialMode: "insert",
      keymaps: { insert: { "\r": "normal" } },
    });
    vi.spyOn(editor, "isShowingAutocomplete").mockReturnValue(true);
    const superHandleSpy = vi.spyOn(
      Object.getPrototypeOf(Object.getPrototypeOf(editor)),
      "handleInput",
    );

    editor.handleInput("\r");
    expect(editor.getMode()).toBe("insert");
    expect(superHandleSpy).toHaveBeenCalledWith("\r");

    superHandleSpy.mockRestore();
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

  it("moves to the next search match and repeats with n/N", () => {
    const { editor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "one\ntwo\nthree" },
    );
    editor.handleInput("0");
    editor.handleInput("/");
    editor.handleInput("t");
    editor.handleInput("\r");
    expect(editor.getCursor()).toEqual({ line: 1, col: 0 });

    editor.handleInput("n");
    expect(editor.getCursor()).toEqual({ line: 2, col: 0 });

    editor.handleInput("N");
    expect(editor.getCursor()).toEqual({ line: 1, col: 0 });
  });

  it("performs :%s/old/new/g substitution", () => {
    const { editor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "foo foo\nfoo" },
    );
    for (const key of ":%s/foo/bar/g") editor.handleInput(key);
    editor.handleInput("\r");
    expect(editor.getText()).toBe("bar bar\nbar");
  });

  it("reports clipboard write failures", () => {
    const { editor, tui } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "abc" },
    );
    tui.terminal.write.mockImplementationOnce(() => {
      throw new Error("clipboard unavailable");
    });
    editor.handleInput("0");
    editor.handleInput("v");
    editor.handleInput("l");
    editor.handleInput("y");
    expect(editor.getYankedText()).toBe("ab");
    expect(editor.getClipboardError()).toContain("clipboard unavailable");
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

  it("shows BASH instead of the editor mode when the prompt is a shell command", () => {
    const { editor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "!ls" },
    );
    const lines = editor.render(80);
    expect(lines[lines.length - 1]).toContain("BASH");
    expect(lines[lines.length - 1]).not.toContain("NORMAL");
  });

  it("continues the left border under the prompt character", () => {
    const { editor } = createMockEditor({}, { initialText: "line1\nline2" });
    const lines = editor.render(80);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines[0]).toContain("╭");
    expect(lines[1]).toContain("▎ line1");
    expect(lines[2]).toContain("│ line2");
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

  it("colors the prompt border by vim mode", () => {
    const modeTheme = {
      fg: (token: string, text: string) => `[${token}]${text}[/]`,
      getBashModeBorderColor: () => (text: string) => `[bash]${text}[/]`,
    };
    const { editor } = createMockEditor(
      {},
      { initialText: "hello", modeTheme },
    );

    expect(editor.render(20)[0]).toContain("[accent]╭[/]");
    expect(editor.render(20)[0]).toContain("[accent]─");

    editor.setMode("normal");
    expect(editor.render(20)[0]).toContain("[border]╭[/]");

    editor.setMode("visual");
    expect(editor.render(20)[0]).toContain("[warning]╭[/]");

    editor.setMode("normal");
    editor.handleInput(":");
    expect(editor.render(20)[0]).toContain("[error]╭[/]");
  });

  it("uses the bash border color for shell prompts", () => {
    const modeTheme = {
      fg: (token: string, text: string) => `[${token}]${text}[/]`,
      getBashModeBorderColor: () => (text: string) => `[bash]${text}[/]`,
    };
    const { editor } = createMockEditor({}, { initialText: "!ls", modeTheme });
    expect(editor.render(20)[0]).toContain("[bash]╭[/]");
  });

  it("renders a full rounded box with themed left and right borders", () => {
    const color = (value: string) => `\x1b[36m${value}\x1b[39m`;
    const { editor } = createMockEditor(
      {},
      { initialText: "hello", borderColor: color },
    );
    const lines = editor.render(20).map(stripCursorMarkers);
    const top = lines[0] ?? "";
    const content = lines[1] ?? "";
    const bottom = lines.at(-1) ?? "";

    expect(top.startsWith(color("╭"))).toBe(true);
    expect(top.endsWith(color("╮"))).toBe(true);
    expect(content.startsWith("▎ ")).toBe(true);
    expect(content.endsWith(color("│"))).toBe(true);
    expect(content).toContain("hello");
    expect(bottom.startsWith(color("╰"))).toBe(true);
    expect(bottom.endsWith(color("╯"))).toBe(true);
    expect(bottom).toContain("INSERT");
    for (const line of lines) {
      expect(visibleWidth(line)).toBe(20);
    }
  });

  it("keeps the prompt decoration without side borders when borderStyle is none", () => {
    const { editor } = createMockEditor(
      { borderStyle: "none" },
      { initialText: "hello" },
    );
    const lines = editor.render(20).map(stripCursorMarkers);
    expect(lines[1]).toContain("▎ hello");
    expect(lines[1]).not.toContain("│");
    expect(lines[0]).not.toContain("╭");
    expect(lines.at(-1)).toContain("INSERT");
  });

  it("treats multi-code-unit text as printable in normal and search modes", () => {
    const { editor: normal } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "hello" },
    );
    normal.handleInput("😀");
    expect(normal.getText()).toBe("hello");

    const { editor: search } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "hello 😀 world\nnope" },
    );
    search.handleInput("/");
    search.handleInput("😀");
    search.handleInput("\r");
    expect(search.getCursor()).toEqual({ line: 0, col: 6 });
  });

  it("opens a new line below with o", () => {
    const { editor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "hello" },
    );
    editor.handleInput("o");
    expect(editor.getMode()).toBe("insert");
    expect(editor.getText()).toBe("hello\n");
    expect(editor.getCursor()).toEqual({ line: 1, col: 0 });
  });

  it("maps u to the host undo sequence", () => {
    const { editor } = createMockEditor({ initialMode: "normal" });
    const superHandle = vi.spyOn(
      Object.getPrototypeOf(Object.getPrototypeOf(editor)),
      "handleInput",
    );
    try {
      editor.handleInput("u");
      expect(superHandle).toHaveBeenCalledWith("\x1f");
    } finally {
      superHandle.mockRestore();
    }
  });

  it("counts graphemes when moving the cursor to a search match", () => {
    const { editor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "😀hello" },
    );
    editor.handleInput("/");
    for (const key of "hello") editor.handleInput(key);
    editor.handleInput("\r");
    expect(editor.getCursor()).toEqual({ line: 0, col: 2 });
  });

  it("consumes Ctrl+C in visual mode like Escape", () => {
    const { editor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "keep" },
    );
    editor.handleInput("0");
    editor.handleInput("v");
    editor.handleInput("l");
    expect(editor.getMode()).toBe("visual");
    expect(editor.getSelection()).not.toBeNull();
    const superHandle = vi.spyOn(
      Object.getPrototypeOf(Object.getPrototypeOf(editor)),
      "handleInput",
    );
    try {
      editor.handleInput("\x03");
      expect(superHandle).not.toHaveBeenCalledWith("\x03");
      expect(editor.getMode()).toBe("normal");
      expect(editor.getSelectionAnchor()).toBeNull();
    } finally {
      superHandle.mockRestore();
    }
  });

  it("matches multi-character insert chords from one key per event", () => {
    const { editor } = createMockEditor({
      initialMode: "insert",
      keymaps: { insert: { jk: null } },
    });
    editor.handleInput("j");
    expect(editor.getMode()).toBe("insert");
    expect(editor.getText()).toBe("");
    editor.handleInput("k");
    expect(editor.getMode()).toBe("normal");
    expect(editor.getText()).toBe("");
  });

  it("inserts a held chord prefix when the chord is not completed", () => {
    const { editor } = createMockEditor({
      initialMode: "insert",
      keymaps: { insert: { jk: null } },
    });
    editor.handleInput("j");
    editor.handleInput("x");
    expect(editor.getMode()).toBe("insert");
    expect(editor.getText()).toBe("jx");
  });

  it("prefers the longest matching insert chord", () => {
    const { editor } = createMockEditor({
      initialMode: "insert",
      keymaps: { insert: { j: "\x1b[C", jk: null } },
    });
    editor.handleInput("j");
    expect(editor.getMode()).toBe("insert");
    expect(editor.getText()).toBe("");
    editor.handleInput("k");
    expect(editor.getMode()).toBe("normal");
  });

  it("does not wrap to the next line when appending at end of a non-final line", () => {
    const { editor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "one\ntwo" },
    );
    editor.handleInput("k");
    editor.handleInput("$");
    expect(editor.getCursor()).toEqual({ line: 0, col: 3 });
    editor.handleInput("a");
    expect(editor.getCursor()).toEqual({ line: 0, col: 3 });
    editor.handleInput("!");
    expect(editor.getText()).toBe("one!\ntwo");
  });

  it("checks user visual keymaps before built-in visual actions", () => {
    const { editor } = createMockEditor(
      { initialMode: "normal", keymaps: { visual: { y: "\x1b[C" } } },
      { initialText: "abc" },
    );
    editor.handleInput("0");
    editor.handleInput("v");
    editor.handleInput("l");
    editor.handleInput("y");
    expect(editor.getMode()).toBe("visual");
    expect(editor.getYankedText()).toBe("");
  });

  it("clears a pending change when entering command mode", () => {
    const { editor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "hello" },
    );
    editor.handleInput("0");
    editor.handleInput("c");
    editor.handleInput(":");
    editor.handleInput("\x1b");
    editor.handleInput("x");
    expect(editor.getText()).toBe("ello");
  });
});

describe("extension registration", () => {
  it("registers editor component on session_start when UI is present", () => {
    const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
    const pi = {
      on: vi.fn((event: string, fn: (event: unknown, ctx: unknown) => void) => {
        handlers[event] = fn;
      }),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      registerToolRenderer: vi.fn(),
    };
    extension(pi as never);

    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));

    const ctx = {
      hasUI: true,
      ui: {
        setEditorComponent: vi.fn(),
        setWorkingIndicator: vi.fn(),
        theme: {
          colors: {
            accent: rgbColor(80, 120, 255),
            borderAccent: rgbColor(80, 220, 255),
            success: rgbColor(80, 220, 120),
            warning: rgbColor(255, 200, 80),
            error: rgbColor(255, 80, 80),
            thinkingText: rgbColor(200, 120, 255),
            text: rgbColor(230, 230, 230),
            muted: rgbColor(120, 120, 120),
          },
          getColorMode: () => "truecolor",
        },
      },
    };

    handlers.session_start?.({}, ctx);
    expect(ctx.ui.setWorkingIndicator).toHaveBeenCalledTimes(1);
    expect(ctx.ui.setEditorComponent).toHaveBeenCalledTimes(1);
    expect(pi.registerShortcut.mock.calls.map(([name]) => name)).toEqual([
      "ctrl+o",
      "ctrl+t",
    ]);
  });

  it("installs the working indicator when the modal editor is disabled", () => {
    const dir = createTempDir();
    process.env.PI_CODING_AGENT_DIR = dir;
    writeFileSync(
      join(dir, "modal.json"),
      JSON.stringify({ enabled: false }),
      "utf8",
    );
    writeFileSync(
      getTuiConfigPath(dir),
      JSON.stringify({ loadingIndicator: "crush", colored: true }),
      "utf8",
    );
    const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
    const pi = {
      on: vi.fn((event: string, fn: (event: unknown, ctx: unknown) => void) => {
        handlers[event] = fn;
      }),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      registerToolRenderer: vi.fn(),
    };
    extension(pi as never);

    const setEditorComponent = vi.fn();
    const setWorkingIndicator = vi.fn();
    const ctx = {
      hasUI: true,
      ui: {
        setEditorComponent,
        setWorkingIndicator,
        theme: {
          colors: {
            accent: rgbColor(80, 120, 255),
            borderAccent: rgbColor(80, 220, 255),
            success: rgbColor(80, 220, 120),
            warning: rgbColor(255, 200, 80),
            error: rgbColor(255, 80, 80),
            thinkingText: rgbColor(200, 120, 255),
            text: rgbColor(230, 230, 230),
            muted: rgbColor(120, 120, 120),
          },
          getColorMode: () => "truecolor",
        },
      },
    };

    handlers.session_start?.({}, ctx);
    expect(setEditorComponent).not.toHaveBeenCalled();
    expect(setWorkingIndicator).toHaveBeenCalledTimes(1);
    const indicator = setWorkingIndicator.mock.calls[0]?.[0] as {
      frames?: string[];
    };
    expect(indicator.frames?.[0]).toContain("\x1b[");
  });

  it("drives streaming shimmer redraws through the animator when the editor is installed", () => {
    const dir = createTempDir();
    process.env.PI_CODING_AGENT_DIR = dir;
    writeFileSync(
      getTuiConfigPath(dir),
      JSON.stringify({
        thinkingVerbosity: "minimal",
        thinkingAnimate: true,
        colored: true,
      }),
      "utf8",
    );
    const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
    let markdownTransformer:
      | ((
          md: string,
          ctx: {
            messageType: string;
            isStreaming: boolean;
            availableWidth: number;
          },
        ) => string)
      | undefined;
    const pi = {
      on: vi.fn((event: string, fn: (event: unknown, ctx: unknown) => void) => {
        handlers[event] = fn;
      }),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      registerToolRenderer: vi.fn(),
      registerMarkdownTransformer: vi.fn(
        (fn: NonNullable<typeof markdownTransformer>) => {
          markdownTransformer = fn;
        },
      ),
      events: { emit: vi.fn() },
    };
    extension(pi as never);

    const requestRender = vi.fn();
    const tui = {
      requestRender,
      terminal: { rows: 24, columns: 80, write: vi.fn() },
    };
    const setEditorComponent = vi.fn(
      (factory: (...args: unknown[]) => unknown) => {
        try {
          factory(tui, {}, {});
        } catch {
          // ModalEditor construction may need host-only theme methods.
        }
      },
    );
    const ctx = {
      hasUI: true,
      ui: {
        setEditorComponent,
        setWorkingIndicator: vi.fn(),
        theme: {
          colors: {
            accent: rgbColor(80, 120, 255),
            borderAccent: rgbColor(80, 220, 255),
            success: rgbColor(80, 220, 120),
            warning: rgbColor(255, 200, 80),
            error: rgbColor(255, 80, 80),
            thinkingText: rgbColor(200, 120, 255),
            text: rgbColor(230, 230, 230),
            muted: rgbColor(120, 120, 120),
          },
          getColorMode: () => "truecolor",
        },
      },
    };
    handlers.session_start?.({}, ctx);
    if (!markdownTransformer) throw new Error("no markdown transformer");

    vi.useFakeTimers();
    try {
      const out = markdownTransformer("Thinking now", {
        messageType: "assistant-thinking",
        isStreaming: true,
        availableWidth: 40,
      });
      expect(out).toContain("\x1b[38;");
      expect(requestRender).not.toHaveBeenCalled();
      vi.advanceTimersByTime(45);
      expect(requestRender).toHaveBeenCalled();

      markdownTransformer("Thinking now", {
        messageType: "assistant-thinking",
        isStreaming: false,
        availableWidth: 40,
      });
      requestRender.mockClear();
      vi.advanceTimersByTime(200);
      expect(requestRender).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies the configured loading indicator to host loaders", () => {
    const pi = {
      on: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
    };
    extension(pi as never);
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      loadingIndicator: "pulse",
      colored: false,
    });

    const loader = new Loader(
      { requestRender: vi.fn() } as never,
      (text) => text,
      (text) => text,
    );
    try {
      expect(stripTerminalSequences(loader.render(20).join("\n"))).toContain(
        "∙",
      );
    } finally {
      loader.stop();
      resetActiveTuiConfig();
    }
  });

  it("keeps the full codemode script preview expanded", () => {
    const pi = {
      on: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      registerToolRenderer: vi.fn(),
    };
    extension(pi as never);

    const resolver = pi.registerToolRenderer.mock.calls[0]?.[0] as (
      toolName: string,
      next: () => unknown,
    ) => { renderCall: (...args: unknown[]) => unknown };
    const renderCall = vi.fn(() => "component");
    const wrapped = resolver("codemode", () => ({ renderCall }));
    wrapped.renderCall({}, {}, { expanded: false });
    expect(renderCall).toHaveBeenCalledWith(
      {},
      {},
      expect.objectContaining({ expanded: true }),
    );

    const other = resolver("bash", () => ({ renderCall }));
    expect(typeof other.renderCall).toBe("function");
  });

  it("bypasses registration when UI is missing", () => {
    const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
    const pi = {
      on: vi.fn((event: string, fn: (event: unknown, ctx: unknown) => void) => {
        handlers[event] = fn;
      }),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      registerToolRenderer: vi.fn(),
    };
    extension(pi as never);

    const ctx = {
      hasUI: false,
      ui: {},
    };

    handlers.session_start?.({}, ctx);
  });

  it("modal visual d, x, and y act on whole graphemes at selection boundaries", () => {
    // 1. Combining character case: "cafe\u0301" with combining acute accent
    const { editor: yankEditor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "cafe\u0301 au lait" },
    );
    yankEditor.handleInput("0");
    yankEditor.handleInput("v");
    yankEditor.handleInput("l");
    yankEditor.handleInput("l");
    yankEditor.handleInput("l");
    yankEditor.handleInput("y");
    expect(yankEditor.getMode()).toBe("normal");
    expect(yankEditor.getYankedText()).toBe("cafe\u0301");
    expect(yankEditor.getText()).toBe("cafe\u0301 au lait");

    const { editor: delEditor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "cafe\u0301 au lait" },
    );
    delEditor.handleInput("0");
    delEditor.handleInput("v");
    delEditor.handleInput("l");
    delEditor.handleInput("l");
    delEditor.handleInput("l");
    delEditor.handleInput("d");
    expect(delEditor.getMode()).toBe("normal");
    expect(delEditor.getYankedText()).toBe("cafe\u0301");
    expect(delEditor.getText()).toBe(" au lait");

    const { editor: xEditor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "cafe\u0301 au lait" },
    );
    xEditor.handleInput("0");
    xEditor.handleInput("v");
    xEditor.handleInput("l");
    xEditor.handleInput("l");
    xEditor.handleInput("l");
    xEditor.handleInput("x");
    expect(xEditor.getMode()).toBe("normal");
    expect(xEditor.getYankedText()).toBe("cafe\u0301");
    expect(xEditor.getText()).toBe(" au lait");

    // 2. Emoji case: "👍🏽 world"
    const { editor: emojiEditor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "👍🏽 world" },
    );
    emojiEditor.handleInput("0");
    emojiEditor.handleInput("v");
    emojiEditor.handleInput("y");
    expect(emojiEditor.getYankedText()).toBe("👍🏽");

    const { editor: emojiDelEditor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "👍🏽 world" },
    );
    emojiDelEditor.handleInput("0");
    emojiDelEditor.handleInput("v");
    emojiDelEditor.handleInput("x");
    expect(emojiDelEditor.getYankedText()).toBe("👍🏽");
    expect(emojiDelEditor.getText()).toBe(" world");
  });

  it("Esc and Ctrl-C in / and : prompts cancel prompt and do not reach the agent", () => {
    const { editor } = createMockEditor(
      { initialMode: "normal" },
      { initialText: "first line\nsecond line" },
    );
    const superHandleSpy = vi.spyOn(
      Object.getPrototypeOf(Object.getPrototypeOf(editor)),
      "handleInput",
    );

    // Open search prompt with '/'
    editor.handleInput("/");
    superHandleSpy.mockClear();

    // Escape closes search prompt without reaching host
    editor.handleInput("\x1b");
    expect(superHandleSpy).not.toHaveBeenCalled();
    expect(editor.getMode()).toBe("normal");

    // Open search prompt again and test Ctrl+C
    editor.handleInput("/");
    superHandleSpy.mockClear();
    editor.handleInput("\x03"); // Ctrl+C
    expect(superHandleSpy).not.toHaveBeenCalled();
    expect(editor.getMode()).toBe("normal");

    // Open command prompt with ':'
    editor.handleInput(":");
    superHandleSpy.mockClear();

    // Escape closes command prompt without reaching host
    editor.handleInput("\x1b");
    expect(superHandleSpy).not.toHaveBeenCalled();
    expect(editor.getMode()).toBe("normal");

    // Open command prompt and test Ctrl+C
    editor.handleInput(":");
    superHandleSpy.mockClear();
    editor.handleInput("\x03"); // Ctrl+C
    expect(superHandleSpy).not.toHaveBeenCalled();
    expect(editor.getMode()).toBe("normal");

    superHandleSpy.mockRestore();
  });
});

describe("skill autocomplete and multiple prompt expansion", () => {
  it("provides skill autocomplete suggestions at start of line and after whitespace", async () => {
    const commands: Array<{
      name: string;
      description?: string;
      source: string;
    }> = [
      {
        name: "skill:git-commit",
        description: "Commit staged changes",
        source: "skill",
      },
      {
        name: "skill:git-push",
        description: "Push changes to remote",
        source: "skill",
      },
      {
        name: "skill:review",
        description: "Review pull request",
        source: "skill",
      },
      {
        name: "help",
        description: "Help command",
        source: "builtin",
      },
    ];

    const pi = {
      getCommands: vi.fn(() => commands),
      on: vi.fn(),
    };

    const baseProvider = {
      triggerCharacters: ["/"],
      getSuggestions: vi.fn(async () => ({ items: [], prefix: "" })),
      applyCompletion: vi.fn(
        (lines: string[], cursorLine: number, cursorCol: number) => ({
          lines,
          cursorLine,
          cursorCol,
        }),
      ),
    };

    const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
    const fullPi = {
      ...pi,
      on: vi.fn((event: string, fn: (event: unknown, ctx: unknown) => void) => {
        handlers[event] = fn;
      }),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      registerToolRenderer: vi.fn(),
    };
    extension(fullPi as never);

    let wrappedProvider: AutocompleteProvider | undefined;
    const ctx = {
      hasUI: true,
      ui: {
        addAutocompleteProvider: vi.fn((factory) => {
          wrappedProvider = factory(baseProvider);
        }),
      },
    };

    handlers.session_start?.({}, ctx);
    expect(ctx.ui.addAutocompleteProvider).toHaveBeenCalledTimes(1);
    if (!wrappedProvider) {
      throw new Error("wrappedProvider was not created");
    }
    expect(wrappedProvider.triggerCharacters).toEqual(["/", "$"]);

    // At start of line ($)
    const suggestionsStart = await wrappedProvider.getSuggestions(["$"], 0, 1, {
      signal: new AbortController().signal,
    });
    expect(suggestionsStart).toEqual({
      items: [
        {
          value: "$git-commit",
          label: "$git-commit",
          description: "Commit staged changes",
        },
        {
          value: "$git-push",
          label: "$git-push",
          description: "Push changes to remote",
        },
        {
          value: "$review",
          label: "$review",
          description: "Review pull request",
        },
      ],
      prefix: "$",
    });

    // After whitespace ($gi)
    const suggestionsWs = await wrappedProvider.getSuggestions(
      ["please run $gi"],
      0,
      14,
      { signal: new AbortController().signal },
    );
    expect(suggestionsWs).toEqual({
      items: [
        {
          value: "$git-commit",
          label: "$git-commit",
          description: "Commit staged changes",
        },
        {
          value: "$git-push",
          label: "$git-push",
          description: "Push changes to remote",
        },
      ],
      prefix: "$gi",
    });

    // Substring vs prefix sorting: prefix matches first, then alphabetical
    const sortCommands = [
      { name: "skill:git-commit", source: "skill" },
      { name: "skill:commit-msg", source: "skill" },
      { name: "skill:commit-lint", source: "skill" },
    ];
    pi.getCommands.mockReturnValue(sortCommands);

    const sortSuggestions = await wrappedProvider.getSuggestions(
      ["$commit"],
      0,
      7,
      { signal: new AbortController().signal },
    );
    expect(
      sortSuggestions?.items.map((i: { value: string }) => i.value),
    ).toEqual(["$commit-lint", "$commit-msg", "$git-commit"]);

    // When not on a $ token: delegates to base
    const nonDollar = await wrappedProvider.getSuggestions(
      ["hello world"],
      0,
      11,
      { signal: new AbortController().signal },
    );
    expect(baseProvider.getSuggestions).toHaveBeenCalledWith(
      ["hello world"],
      0,
      11,
      expect.any(Object),
    );
    expect(nonDollar).toEqual({ items: [], prefix: "" });

    // When on $ token but no skills match: returns null
    const noMatch = await wrappedProvider.getSuggestions(
      ["$nonexistent"],
      0,
      12,
      { signal: new AbortController().signal },
    );
    expect(noMatch).toBeNull();
  });

  it("applies completion with trailing space and cursor positioning for chaining", () => {
    const pi = {
      getCommands: vi.fn(() => []),
    };

    const baseProvider = {
      applyCompletion: vi.fn(
        (lines: string[], cursorLine: number, cursorCol: number) => ({
          lines,
          cursorLine,
          cursorCol,
        }),
      ),
      shouldTriggerFileCompletion: vi.fn(() => true),
    };

    const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
    const fullPi = {
      ...pi,
      on: vi.fn((event: string, fn: (event: unknown, ctx: unknown) => void) => {
        handlers[event] = fn;
      }),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      registerToolRenderer: vi.fn(),
    };
    extension(fullPi as never);

    let wrappedProvider: AutocompleteProvider | undefined;
    const ctx = {
      hasUI: true,
      ui: {
        addAutocompleteProvider: vi.fn((factory) => {
          wrappedProvider = factory(baseProvider);
        }),
      },
    };

    handlers.session_start?.({}, ctx);

    // Case 1: Complete at end of line -> inserts trailing space and moves cursor past it
    const completed1 = wrappedProvider?.applyCompletion(
      ["$g"],
      0,
      2,
      { value: "$git", label: "$git" },
      "$g",
    );
    expect(completed1).toEqual({
      lines: ["$git "],
      cursorLine: 0,
      cursorCol: 5,
    });

    // Chaining test: typing $ after this completion starts a new token
    const chainedLine = `${completed1?.lines[0]}$`;
    const beforeChained = chainedLine.slice(0, 6);
    expect(/(?:^|[\s])(\$[^\s]*)$/.test(beforeChained)).toBe(true);

    // Case 2: Whitespace already follows cursor -> does not insert extra space
    const completed2 = wrappedProvider?.applyCompletion(
      ["$g next"],
      0,
      2,
      { value: "$git", label: "$git" },
      "$g",
    );
    expect(completed2).toEqual({
      lines: ["$git next"],
      cursorLine: 0,
      cursorCol: 4,
    });

    // Case 3: Non-$ prefix delegates to base
    wrappedProvider?.applyCompletion(
      ["/he"],
      0,
      3,
      { value: "/help", label: "/help" },
      "/he",
    );
    expect(baseProvider.applyCompletion).toHaveBeenCalledWith(
      ["/he"],
      0,
      3,
      { value: "/help", label: "/help" },
      "/he",
    );

    // Forwarding shouldTriggerFileCompletion
    expect(wrappedProvider?.shouldTriggerFileCompletion?.(["test"], 0, 4)).toBe(
      true,
    );
    expect(baseProvider.shouldTriggerFileCompletion).toHaveBeenCalledWith(
      ["test"],
      0,
      4,
    );
  });

  it("does not double-wrap provider on repeated session_start calls", () => {
    const baseProvider = {
      triggerCharacters: ["/"],
      getSuggestions: vi.fn(async () => null),
      applyCompletion: vi.fn(
        (lines: string[], cursorLine: number, cursorCol: number) => ({
          lines,
          cursorLine,
          cursorCol,
        }),
      ),
    };

    const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
    const pi = {
      on: vi.fn((event: string, fn: (event: unknown, ctx: unknown) => void) => {
        handlers[event] = fn;
      }),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      registerToolRenderer: vi.fn(),
      getCommands: vi.fn(() => []),
    };
    extension(pi as never);

    let wrappedFirst: AutocompleteProvider | undefined;
    const ctx = {
      hasUI: true,
      ui: {
        addAutocompleteProvider: vi.fn((factory) => {
          wrappedFirst = factory(baseProvider);
        }),
      },
    };

    handlers.session_start?.({}, ctx);
    handlers.session_start?.({}, ctx);

    // Repeated call with the same wrapped provider returns the provider without double-wrapping
    const factory = ctx.ui.addAutocompleteProvider.mock.calls[0][0];
    const reWrapped = factory(wrappedFirst);
    expect(reWrapped).toBe(wrappedFirst);
  });

  it("expands single and multiple $skill-name invocations in input event", () => {
    const tempDir = createTempDir();
    const skillOnePath = join(tempDir, "skill-one.md");
    const skillTwoPath = join(tempDir, "skill-two.md");

    writeFileSync(
      skillOnePath,
      `---
name: skill-one
description: First test skill
---

# Skill One
Perform operation one.`,
    );

    writeFileSync(
      skillTwoPath,
      `---
name: skill-two
description: Second test skill
---

# Skill Two
Perform operation two.`,
    );

    const commands = [
      {
        name: "skill:skill-one",
        source: "skill",
        sourceInfo: {
          path: skillOnePath,
          baseDir: tempDir,
        },
      },
      {
        name: "skill:skill-two",
        source: "skill",
        sourceInfo: {
          path: skillTwoPath,
          baseDir: tempDir,
        },
      },
    ];

    const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> =
      {};
    const pi = {
      on: vi.fn(
        (event: string, fn: (event: unknown, ctx: unknown) => unknown) => {
          handlers[event] = fn;
        },
      ),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      registerToolRenderer: vi.fn(),
      getCommands: vi.fn(() => commands),
    };
    extension(pi as never);

    const inputHandler = handlers.input;
    expect(inputHandler).toBeDefined();

    // 1. Single skill without prompt text
    const res1 = inputHandler(
      { text: "$skill-one", type: "input", source: "user" },
      {},
    );
    expect(res1).toEqual({
      action: "transform",
      text: `<skill name="skill-one" location="${skillOnePath}">\nReferences are relative to ${tempDir}.\n\n# Skill One\nPerform operation one.\n</skill>\n\n$skill-one`,
    });

    // 2. Single skill with prompt text
    const res2 = inputHandler(
      { text: "$skill-one please review this", type: "input", source: "user" },
      {},
    );
    expect(res2).toEqual({
      action: "transform",
      text: `<skill name="skill-one" location="${skillOnePath}">\nReferences are relative to ${tempDir}.\n\n# Skill One\nPerform operation one.\n</skill>\n\n$skill-one please review this`,
    });

    // 3. Multiple skills without prompt text
    const res3 = inputHandler(
      { text: "$skill-one $skill-two", type: "input", source: "user" },
      {},
    );
    expect(res3).toEqual({
      action: "transform",
      text: `<skill name="skill-one" location="${skillOnePath}">\nReferences are relative to ${tempDir}.\n\n# Skill One\nPerform operation one.\n</skill>\n\n<skill name="skill-two" location="${skillTwoPath}">\nReferences are relative to ${tempDir}.\n\n# Skill Two\nPerform operation two.\n</skill>\n\n$skill-one $skill-two`,
    });

    // 4. Multiple skills with prompt text
    const res4 = inputHandler(
      {
        text: "$skill-one $skill-two please review this",
        type: "input",
        source: "user",
      },
      {},
    );
    expect(res4).toEqual({
      action: "transform",
      text: `<skill name="skill-one" location="${skillOnePath}">\nReferences are relative to ${tempDir}.\n\n# Skill One\nPerform operation one.\n</skill>\n\n<skill name="skill-two" location="${skillTwoPath}">\nReferences are relative to ${tempDir}.\n\n# Skill Two\nPerform operation two.\n</skill>\n\n$skill-one $skill-two please review this`,
    });

    // 5. Skills inline inside prompt text
    const res5 = inputHandler(
      {
        text: "please use $skill-one and $skill-two",
        type: "input",
        source: "user",
      },
      {},
    );
    expect(res5).toEqual({
      action: "transform",
      text: `<skill name="skill-one" location="${skillOnePath}">\nReferences are relative to ${tempDir}.\n\n# Skill One\nPerform operation one.\n</skill>\n\n<skill name="skill-two" location="${skillTwoPath}">\nReferences are relative to ${tempDir}.\n\n# Skill Two\nPerform operation two.\n</skill>\n\nplease use $skill-one and $skill-two`,
    });

    // 6. Deduplicating repeated mentions of the same skill
    const res6 = inputHandler(
      {
        text: "$skill-one please test with $skill-one",
        type: "input",
        source: "user",
      },
      {},
    );
    expect(res6).toEqual({
      action: "transform",
      text: `<skill name="skill-one" location="${skillOnePath}">\nReferences are relative to ${tempDir}.\n\n# Skill One\nPerform operation one.\n</skill>\n\n$skill-one please test with $skill-one`,
    });

    // 7. Ignoring unknown variables like $HOME
    const res7 = inputHandler(
      {
        text: "$skill-one echo $HOME",
        type: "input",
        source: "user",
      },
      {},
    );
    expect(res7).toEqual({
      action: "transform",
      text: `<skill name="skill-one" location="${skillOnePath}">\nReferences are relative to ${tempDir}.\n\n# Skill One\nPerform operation one.\n</skill>\n\n$skill-one echo $HOME`,
    });

    // 8. No known skills -> returns undefined
    const res8 = inputHandler(
      {
        text: "echo $HOME and $UNKNOWN",
        type: "input",
        source: "user",
      },
      {},
    );
    expect(res8).toBeUndefined();

    // 9. Commands starting with / or ! -> returns undefined
    const res9a = inputHandler(
      {
        text: "/custom $skill-one",
        type: "input",
        source: "user",
      },
      {},
    );
    expect(res9a).toBeUndefined();

    const res9b = inputHandler(
      {
        text: "!echo $skill-one",
        type: "input",
        source: "user",
      },
      {},
    );
    expect(res9b).toBeUndefined();
  });
});

describe("TUI config, /ui command, and panel integration", () => {
  it("renders full mode badges and inherits borderStyle from active TUI config", () => {
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      borderStyle: "double",
    });
    const { editor } = createMockEditor({ initialMode: "normal" });
    const doubleLines = editor.render(40).map(stripTerminalSequences);
    expect(doubleLines[0]).toContain("╔══");
    expect(doubleLines[0]).not.toContain("─");
    expect(doubleLines.at(-1)).toContain("══ NORMAL ╝");

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      borderStyle: "dashed",
      colored: false,
    });
    const monoDashedRaw = editor.render(40);
    const monoDashed = monoDashedRaw.map(stripTerminalSequences);
    expect(monoDashed[0]).toContain("┌┄┄");
    expect(monoDashedRaw[0]).not.toContain("\x1b[36m");
    expect(monoDashed.at(-1)).toContain("┄┄ NORMAL ┘");

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      borderStyle: "none",
    });
    const borderless = editor.render(40).map(stripCursorMarkers);
    expect(borderless[0]).not.toContain("─");
    expect(borderless.at(-1)).not.toContain("─");
    expect(borderless.at(-1)).toContain(" NORMAL ");

    editor.setMode("insert");
    expect(editor.render(40).at(-1)).toContain(" INSERT ");

    editor.setMode("visual");
    expect(editor.render(40).at(-1)).toContain(" VISUAL ");

    editor.setText("!ls");
    expect(editor.render(40).at(-1)).toContain(" BASH ");
  });

  it("loads tui.json on session_start and warns on EACCES", () => {
    if (process.getuid?.() === 0) return;
    const dir = createTempDir();
    process.env.PI_CODING_AGENT_DIR = dir;
    const path = getTuiConfigPath(dir);
    writeFileSync(path, JSON.stringify({ borderStyle: "double" }), "utf8");
    chmodSync(path, 0o000);

    try {
      const handlers: Record<string, (event: unknown, ctx: unknown) => void> =
        {};
      const pi = {
        on: vi.fn(
          (event: string, fn: (event: unknown, ctx: unknown) => void) => {
            handlers[event] = fn;
          },
        ),
        registerCommand: vi.fn(),
        registerShortcut: vi.fn(),
        registerToolRenderer: vi.fn(),
      };
      extension(pi as never);

      const notify = vi.fn();
      handlers.session_start?.(
        {},
        {
          hasUI: false,
          ui: { notify },
        },
      );
      expect(notify).toHaveBeenCalledWith(
        expect.stringMatching(/EACCES|permission denied/i),
        "warning",
      );
      expect(getActiveTuiConfig()).toEqual(DEFAULT_TUI_CONFIG);
    } finally {
      chmodSync(path, 0o600);
    }
  });

  it("registers /ui with completions, status, and settings", async () => {
    const dir = createTempDir();
    process.env.PI_CODING_AGENT_DIR = dir;
    const commands: Record<
      string,
      {
        handler: (args: string, ctx: unknown) => Promise<void>;
        getArgumentCompletions?: (prefix: string) => Array<{ value: string }>;
      }
    > = {};
    const pi = {
      on: vi.fn(),
      registerCommand: vi.fn((name: string, def: (typeof commands)[string]) => {
        commands[name] = def;
      }),
      registerShortcut: vi.fn(),
      registerToolRenderer: vi.fn(),
      events: { emit: vi.fn() },
    };
    extension(pi as never);

    const uiCommand = commands.ui;
    expect(uiCommand).toBeDefined();
    expect(
      uiCommand?.getArgumentCompletions?.("").map((item) => item.value),
    ).toEqual(["settings", "status"]);
    expect(
      uiCommand?.getArgumentCompletions?.("co").map((item) => item.value),
    ).toEqual([]);

    const notify = vi.fn();
    await uiCommand?.handler("status", {
      hasUI: true,
      mode: "print",
      ui: { notify },
    });
    expect(notify).toHaveBeenLastCalledWith(
      expect.stringContaining("borderStyle=rounded"),
      "info",
    );

    let overlay:
      | {
          render: (width: number) => string[];
          handleInput: (d: string) => void;
        }
      | undefined;
    const custom = vi.fn(
      (
        factory: (
          tui: unknown,
          theme: unknown,
          kb: unknown,
          done: () => void,
        ) => {
          render: (width: number) => string[];
          handleInput: (d: string) => void;
        },
      ) =>
        new Promise<void>((resolve) => {
          overlay = factory(
            { requestRender: vi.fn(), invalidate: vi.fn() },
            {
              fg: (_t: string, v: string) => v,
              bg: (_t: string, v: string) => v,
              bold: (v: string) => v,
            },
            {},
            resolve,
          );
        }),
    );

    const pending = uiCommand?.handler("settings", {
      hasUI: true,
      mode: "tui",
      ui: { custom, notify },
    });
    await vi.waitFor(() => expect(overlay).toBeDefined());
    overlay?.handleInput("\r");
    expect(getActiveTuiConfig().borderStyle).toBe("sharp");
    expect(pi.events.emit).toHaveBeenCalledWith(
      "tui:config-changed",
      expect.objectContaining({ borderStyle: "sharp" }),
    );
    overlay?.handleInput("\t");
    overlay?.handleInput("\x1b[B");
    overlay?.handleInput("\r");
    expect(pi.events.emit).toHaveBeenLastCalledWith(
      "tui:config-changed",
      expect.objectContaining({ toolVerbosity: "high" }),
    );
    overlay?.handleInput("\x1b");
    await pending;
  });

  it("wraps tools with panel when panel.enabled is true", () => {
    const pi = {
      on: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      registerToolRenderer: vi.fn(),
    };
    extension(pi as never);
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      verbPack: "terse",
      panel: {
        ...DEFAULT_TUI_CONFIG.panel,
        enabled: true,
      },
    });

    const resolver = pi.registerToolRenderer.mock.calls[0]?.[0] as (
      toolName: string,
      next: () => unknown,
    ) => {
      renderShell?: string;
      renderCall?: (
        args: unknown,
        theme: unknown,
        ctx: unknown,
      ) => {
        render: (width: number) => string[];
      };
    };

    const baseRenderCall = vi.fn(() => ({
      render: () => ["preview"],
      invalidate: vi.fn(),
    }));
    const wrapped = resolver("codemode", () => ({
      renderCall: baseRenderCall,
    }));
    expect(wrapped.renderShell).toBe("self");
    const lines =
      wrapped
        .renderCall?.(
          { code: "x" },
          { fg: (_t: string, v: string) => v, bold: (v: string) => v },
          { expanded: false, isPartial: false, state: {} },
        )
        .render(40) ?? [];
    expect(baseRenderCall).toHaveBeenCalledWith(
      { code: "x" },
      expect.any(Object),
      expect.objectContaining({ expanded: true }),
    );
    expect(lines.join("\n")).toContain("code");
  });

  it("transforms markdown and one-line thinking and animates streaming thinking", async () => {
    const dir = createTempDir();
    process.env.PI_CODING_AGENT_DIR = dir;
    const commands: Record<
      string,
      {
        handler: (args: string, ctx: unknown) => Promise<void>;
        getArgumentCompletions?: (prefix: string) => Array<{ value: string }>;
      }
    > = {};
    const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
    let markdownTransformer:
      | ((
          md: string,
          ctx: {
            messageType: "user" | "assistant" | "assistant-thinking";
            isStreaming: boolean;
            availableWidth: number;
          },
        ) => string)
      | undefined;

    const pi = {
      on: vi.fn((event: string, fn: (event: unknown, ctx: unknown) => void) => {
        handlers[event] = fn;
      }),
      registerCommand: vi.fn((name: string, def: (typeof commands)[string]) => {
        commands[name] = def;
      }),
      registerShortcut: vi.fn(),
      registerToolRenderer: vi.fn(),
      registerMarkdownTransformer: vi.fn(
        (fn: NonNullable<typeof markdownTransformer>) => {
          markdownTransformer = fn;
        },
      ),
      events: { emit: vi.fn() },
    };
    extension(pi as never);

    expect(commands.ui).toBeDefined();
    expect(
      commands.ui?.getArgumentCompletions?.("").map((item) => item.value),
    ).toEqual(["settings", "status"]);

    const notify = vi.fn();
    await commands.ui?.handler("status", {
      hasUI: true,
      mode: "print",
      ui: { notify },
    });
    expect(notify).toHaveBeenLastCalledWith(
      expect.stringContaining("loadingIndicator=crush"),
      "info",
    );

    expect(markdownTransformer).toBeDefined();
    expect(
      markdownTransformer?.("Summary\n===\nNext", {
        messageType: "assistant",
        isStreaming: false,
        availableWidth: 60,
      }),
    ).toBe("Summary\n\n---\nNext");

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      thinkingVerbosity: "minimal",
      thinkingAnimate: true,
      colored: true,
    });

    const transformedThinking = markdownTransformer?.(
      "Step 1: check config\nStep 2: verify border rendering",
      {
        messageType: "assistant-thinking",
        isStreaming: true,
        availableWidth: 40,
      },
    );
    expect(transformedThinking).toContain("\x1b[38;");
    expect(stripTerminalSequences(transformedThinking ?? "")).toContain(
      "Thinking: Step 1",
    );

    const markdownThinking = markdownTransformer?.(
      "Inspecting **border** and `clip`",
      {
        messageType: "assistant-thinking",
        isStreaming: true,
        availableWidth: 60,
      },
    );
    expect(stripTerminalSequences(markdownThinking ?? "")).toBe(
      "Thinking: Inspecting border and clip",
    );
    const settledThinking = markdownTransformer?.(
      "Inspecting **border** and `clip`",
      {
        messageType: "assistant-thinking",
        isStreaming: false,
        availableWidth: 60,
      },
    );
    expect(settledThinking).toBe("Thinking: Inspecting **border** and `clip`");
    expect(
      markdownTransformer?.("Earlier thought\nmore detail", {
        messageType: "assistant-thinking",
        isStreaming: false,
        availableWidth: 60,
      }),
    ).toBe("Thinking: Earlier thought");

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      thinkingVerbosity: "verbose",
    });
    expect(
      markdownTransformer?.("Alpha **bold**", {
        messageType: "assistant-thinking",
        isStreaming: false,
        availableWidth: 60,
      }),
    ).toBe("Alpha **bold**");

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      thinkingVerbosity: "minimal",
      thinkingAnimate: false,
      verbPack: "terse",
    });
    expect(
      markdownTransformer?.("Alpha\nBeta", {
        messageType: "assistant-thinking",
        isStreaming: true,
        availableWidth: 60,
      }),
    ).toBe("think: Alpha");

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      thinkingVerbosity: "minimal",
      thinkingAnimate: false,
      verbPack: "playful",
    });
    expect(
      markdownTransformer?.("Alpha\nBeta", {
        messageType: "assistant-thinking",
        isStreaming: false,
        availableWidth: 60,
      }),
    ).toBe("Pondering: Alpha");

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      thinkingVerbosity: "none",
    });
    expect(
      markdownTransformer?.("Line 1\nLine 2 inspecting", {
        messageType: "assistant-thinking",
        isStreaming: false,
        availableWidth: 60,
      }),
    ).toBe("");
  });

  it("uses the host hidden label, the one-line preview, and host expanded thinking", () => {
    initTheme("dark");
    const pi = {
      on: vi.fn(() => () => {}),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      registerToolRenderer: vi.fn(),
      registerMarkdownTransformer:
        vi.fn<(transformer: MarkdownTransformer) => void>(),
      events: { emit: vi.fn() },
    };
    extension(pi as never);
    const transform = pi.registerMarkdownTransformer.mock.calls[0][0];
    const message = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Alpha **bold**\n\nBeta detail" },
      ],
      stopReason: "stop",
    } as never;
    const component = new AssistantMessageComponent(
      message,
      false,
      undefined,
      "Host collapsed label",
      0,
      [transform],
    );
    const select = (thinkingVerbosity: "low" | "medium" | "high") => {
      setActiveTuiConfig({
        ...DEFAULT_TUI_CONFIG,
        thinkingVerbosity,
        thinkingAnimate: false,
        colored: false,
      });
      component.invalidate();
      return stripTerminalSequences(component.render(60).join("\n"));
    };

    expect(select("low")).toContain("Host collapsed label");
    expect(select("low")).not.toContain("Alpha");
    component.setHideThinkingBlock(true);
    expect(select("medium")).toContain("Thinking: Alpha bold");
    expect(select("medium")).not.toContain("Beta detail");
    expect(select("high")).toContain("Alpha bold");
    expect(select("high")).toContain("Beta detail");
  });
});
