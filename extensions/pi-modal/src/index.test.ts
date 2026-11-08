import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AutocompleteProvider,
  rgbColor,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModalEditor } from "./editor.js";
import extension from "./index.js";
import {
  DEFAULT_NORMAL_KEYS,
  loadModalConfig,
  resolveEffectiveKeymaps,
} from "./keymap.js";

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
  for (const dir of tmpDirs) {
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
    expect(lines[1]).toContain("❯ line1");
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
    expect(content.startsWith("❯ ")).toBe(true);
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
    expect(lines[1]).toContain("❯ hello");
    expect(lines[1]).not.toContain("│");
    expect(lines[0]).not.toContain("╭");
    expect(lines.at(-1)).toContain("INSERT");
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
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "vimkeys",
      expect.objectContaining({ handler: expect.any(Function) }),
    );
    expect(pi.registerShortcut).toHaveBeenCalledWith(
      "ctrl+shift+k",
      expect.objectContaining({ handler: expect.any(Function) }),
    );
  });

  it("registers /expand and toggles tool output", async () => {
    const commands: Record<
      string,
      { handler: (args: string, ctx: unknown) => Promise<void> }
    > = {};
    const pi = {
      on: vi.fn(),
      registerCommand: vi.fn((name: string, def: (typeof commands)[string]) => {
        commands[name] = def;
      }),
      registerShortcut: vi.fn(),
      registerToolRenderer: vi.fn(),
    };
    extension(pi as never);
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "expand",
      expect.any(Object),
    );

    let expanded = false;
    const ui = {
      getToolsExpanded: vi.fn(() => expanded),
      setToolsExpanded: vi.fn((value: boolean) => {
        expanded = value;
      }),
      notify: vi.fn(),
    };
    const ctx = { hasUI: true, ui };

    await commands.expand?.handler("", ctx);
    expect(expanded).toBe(true);
    expect(ui.notify).toHaveBeenLastCalledWith(
      "pi-modal: tool output expanded",
    );

    await commands.expand?.handler("off", ctx);
    expect(expanded).toBe(false);
    expect(ui.notify).toHaveBeenLastCalledWith(
      "pi-modal: tool output collapsed",
    );

    await commands.expand?.handler("bogus", ctx);
    expect(ui.notify).toHaveBeenLastCalledWith(
      "Usage: /expand [on|off|toggle]",
      "error",
    );
  });

  it("opens the last codemode script with ctrl+shift+o", async () => {
    const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
    const shortcuts: Record<
      string,
      { handler: (ctx: unknown) => Promise<void> }
    > = {};
    const pi = {
      on: vi.fn((event: string, fn: (event: unknown, ctx: unknown) => void) => {
        handlers[event] = fn;
      }),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(
        (key: string, def: (typeof shortcuts)[string]) => {
          shortcuts[key] = def;
        },
      ),
    };
    extension(pi as never);

    let component: { render: (width: number) => string[] } | undefined;
    const custom = vi.fn(
      async (
        factory: (
          tui: unknown,
          theme: unknown,
          keybindings: unknown,
          done: () => void,
        ) => { render: (width: number) => string[] },
      ) => {
        component = factory(
          { terminal: { rows: 30 }, requestRender: vi.fn() },
          {
            fg: (_token: string, value: string) => value,
            bold: (value: string) => value,
          },
          {},
          vi.fn(),
        );
      },
    );
    const notify = vi.fn();
    const ctx = {
      hasUI: true,
      mode: "tui",
      sessionManager: { getBranch: () => [] },
      ui: { custom, notify },
    };

    await shortcuts["ctrl+shift+o"]?.handler(ctx);
    expect(notify).toHaveBeenLastCalledWith(
      "pi-modal: no codemode script yet",
      "info",
    );

    handlers.tool_call?.(
      {
        toolName: "codemode",
        input: { code: "const answer = 42;" },
      },
      undefined,
    );
    await shortcuts["ctrl+shift+o"]?.handler(ctx);
    expect(custom).toHaveBeenCalledTimes(1);
    const lines = component?.render(40) ?? [];
    expect(lines[0]).toContain("╭");
    expect(lines.at(-1)).toContain("╰");
    expect(lines.join("\n")).toContain("const answer = 42;");
  });

  it("recovers the last codemode script from the session branch", async () => {
    const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
    const shortcuts: Record<
      string,
      { handler: (ctx: unknown) => Promise<void> }
    > = {};
    const pi = {
      on: vi.fn((event: string, fn: (event: unknown, ctx: unknown) => void) => {
        handlers[event] = fn;
      }),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(
        (key: string, def: (typeof shortcuts)[string]) => {
          shortcuts[key] = def;
        },
      ),
    };
    extension(pi as never);

    let rendered: string[] = [];
    const ctx = {
      hasUI: true,
      mode: "tui",
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "assistant",
              content: [
                {
                  type: "toolCall",
                  name: "codemode",
                  arguments: { code: "const fromBranch = 1;" },
                },
              ],
            },
          },
        ],
      },
      ui: {
        custom: vi.fn(
          async (
            factory: (
              tui: unknown,
              theme: unknown,
              keybindings: unknown,
              done: () => void,
            ) => { render: (width: number) => string[] },
          ) => {
            const component = factory(
              { terminal: { rows: 30 }, requestRender: vi.fn() },
              {
                fg: (_token: string, value: string) => value,
                bold: (value: string) => value,
              },
              {},
              vi.fn(),
            );
            rendered = component.render(40);
          },
        ),
        notify: vi.fn(),
      },
    };

    await shortcuts["ctrl+shift+o"]?.handler(ctx);
    expect(rendered.join("\n")).toContain("const fromBranch = 1;");
  });

  it("falls back to the last tool call when no codemode script exists", async () => {
    const handlers: Record<string, (event: unknown, ctx: unknown) => void> = {};
    const shortcuts: Record<
      string,
      { handler: (ctx: unknown) => Promise<void> }
    > = {};
    const pi = {
      on: vi.fn((event: string, fn: (event: unknown, ctx: unknown) => void) => {
        handlers[event] = fn;
      }),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(
        (key: string, def: (typeof shortcuts)[string]) => {
          shortcuts[key] = def;
        },
      ),
    };
    extension(pi as never);

    let rendered: string[] = [];
    const ctx = {
      hasUI: true,
      mode: "tui",
      sessionManager: { getBranch: () => [] },
      ui: {
        custom: vi.fn(
          async (
            factory: (
              tui: unknown,
              theme: unknown,
              keybindings: unknown,
              done: () => void,
            ) => { render: (width: number) => string[] },
          ) => {
            const component = factory(
              { terminal: { rows: 30 }, requestRender: vi.fn() },
              {
                fg: (_token: string, value: string) => value,
                bold: (value: string) => value,
              },
              {},
              vi.fn(),
            );
            rendered = component.render(40);
          },
        ),
        notify: vi.fn(),
      },
    };

    handlers.tool_call?.(
      { toolName: "web_search", input: { query: "lil bro" } },
      undefined,
    );
    await shortcuts["ctrl+shift+o"]?.handler(ctx);
    expect(rendered.join("\n")).toContain("Last tool call");
    expect(rendered.join("\n")).toContain('"query": "lil bro"');
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
    expect(other.renderCall).toBe(renderCall);
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
      text: `<skill name="skill-one" location="${skillOnePath}">\nReferences are relative to ${tempDir}.\n\n# Skill One\nPerform operation one.\n</skill>`,
    });

    // 2. Single skill with prompt text
    const res2 = inputHandler(
      { text: "$skill-one please review this", type: "input", source: "user" },
      {},
    );
    expect(res2).toEqual({
      action: "transform",
      text: `<skill name="skill-one" location="${skillOnePath}">\nReferences are relative to ${tempDir}.\n\n# Skill One\nPerform operation one.\n</skill>\n\nplease review this`,
    });

    // 3. Multiple skills without prompt text
    const res3 = inputHandler(
      { text: "$skill-one $skill-two", type: "input", source: "user" },
      {},
    );
    expect(res3).toEqual({
      action: "transform",
      text: `<skill name="skill-one" location="${skillOnePath}">\nReferences are relative to ${tempDir}.\n\n# Skill One\nPerform operation one.\n</skill>\n\n<skill name="skill-two" location="${skillTwoPath}">\nReferences are relative to ${tempDir}.\n\n# Skill Two\nPerform operation two.\n</skill>`,
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
      text: `<skill name="skill-one" location="${skillOnePath}">\nReferences are relative to ${tempDir}.\n\n# Skill One\nPerform operation one.\n</skill>\n\n<skill name="skill-two" location="${skillTwoPath}">\nReferences are relative to ${tempDir}.\n\n# Skill Two\nPerform operation two.\n</skill>\n\nplease review this`,
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
      text: `<skill name="skill-one" location="${skillOnePath}">\nReferences are relative to ${tempDir}.\n\n# Skill One\nPerform operation one.\n</skill>\n\n<skill name="skill-two" location="${skillTwoPath}">\nReferences are relative to ${tempDir}.\n\n# Skill Two\nPerform operation two.\n</skill>\n\nplease use and`,
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
      text: `<skill name="skill-one" location="${skillOnePath}">\nReferences are relative to ${tempDir}.\n\n# Skill One\nPerform operation one.\n</skill>\n\nplease test with`,
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
      text: `<skill name="skill-one" location="${skillOnePath}">\nReferences are relative to ${tempDir}.\n\n# Skill One\nPerform operation one.\n</skill>\n\necho $HOME`,
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
