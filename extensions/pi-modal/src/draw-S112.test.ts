import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ModalEditor } from "./editor.js";
import { loadModalConfig } from "./keymap.js";

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

describe("S112 vim CustomEditor modes", () => {
  it("starts in the configured mode and moves between normal, insert, and visual", () => {
    const dir = mkdtempSync(join(tmpdir(), "s112-modal-"));
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
});
