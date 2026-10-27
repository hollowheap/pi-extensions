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
    terminal: { rows: 24, columns: 80 },
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
    expect(config.keymaps?.normal).toEqual({});
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
