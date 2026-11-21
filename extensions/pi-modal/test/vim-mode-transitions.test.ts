import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ModalEditor } from "../src/editor.js";
import { resolveEffectiveKeymaps } from "../src/keymap.js";
import { loadModalConfig } from "../src/settings.js";

function createEditor(config?: unknown) {
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
  return new ModalEditor(
    tui as never,
    theme as never,
    { matches: vi.fn(() => false) } as never,
    config as never,
  );
}

describe("vim CustomEditor modes", () => {
  it("starts in the configured mode and moves between normal, insert, and visual", () => {
    const dir = mkdtempSync(join(tmpdir(), "vim-mode-transitions-modal-"));
    writeFileSync(
      join(dir, "modal.json"),
      JSON.stringify({ initialMode: "normal" }),
    );
    expect(loadModalConfig(dir).initialMode).toBe("normal");

    const editor = createEditor({ initialMode: "normal" });
    expect(editor.getMode()).toBe("normal");
    editor.handleInput("i");
    expect(editor.getMode()).toBe("insert");
    editor.handleInput("\x1b");
    expect(editor.getMode()).toBe("normal");
    editor.handleInput("v");
    expect(editor.getMode()).toBe("visual");
    editor.handleInput("\x1b");
    expect(editor.getMode()).toBe("normal");
  });

  it("a missing modal.json yields insert mode and the default prompt", () => {
    const dir = mkdtempSync(join(tmpdir(), "vim-mode-transitions-modal-"));
    const config = loadModalConfig(dir);
    expect(config.initialMode).toBe("insert");
    expect(createEditor().getMode()).toBe("insert");
  });

  it("an invalid initialMode is diagnosed and falls back to insert", () => {
    const dir = mkdtempSync(join(tmpdir(), "vim-mode-transitions-modal-"));
    writeFileSync(
      join(dir, "modal.json"),
      JSON.stringify({ initialMode: "command" }),
    );
    const diagnostics: string[] = [];
    const config = loadModalConfig(dir, (message) => diagnostics.push(message));
    expect(config.initialMode).toBe("insert");
    expect(diagnostics.some((message) => message.includes("initialMode"))).toBe(
      true,
    );
  });

  it("user keymaps override defaults without dropping other keys", () => {
    const editor = createEditor({ keymaps: { normal: { h: "\x1b[C" } } });
    expect(editor.getKeymaps().normal.h).toBe("\x1b[C");
    expect(editor.getKeymaps().normal.l).toBe("\x1b[C");
    expect(resolveEffectiveKeymaps().normal.h).toBe("\x1b[D");
  });
});
