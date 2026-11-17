import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getBorderChars } from "@hollowheap/core/border";
import { ModalEditor } from "./editor.js";
import { loadModalConfig } from "./keymap.js";

describe("S119 prompt prefix and rounded corners", () => {
  it("uses a single custom prompt char and renders rounded box corners", () => {
    const dir = mkdtempSync(join(tmpdir(), "s119-modal-"));
    writeFileSync(join(dir, "modal.json"), JSON.stringify({ promptChar: "$" }));
    const config = loadModalConfig(dir);
    const editor = new ModalEditor(
      { requestRender: vi.fn(), terminal: { rows: 24, columns: 80, write: vi.fn() } } as never,
      { borderColor: (s: string) => s, selectList: {} } as never,
      { matches: vi.fn(() => false) } as never,
      config,
    );
    expect(editor.getPromptChar()).toBe("$");

    const corners = getBorderChars("rounded");
    expect(corners).toMatchObject({
      topLeft: "╭",
      topRight: "╮",
      bottomLeft: "╰",
      bottomRight: "╯",
    });
  });
});
