import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBorderChars } from "@hollowheap/core/border";
import { DEFAULT_TUI_CONFIG } from "@hollowheap/core/tui-config";
import { resetActiveTuiConfig, setActiveTuiConfig } from "@hollowheap/ui/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModalEditor } from "../src/editor.js";
import { loadModalConfig } from "../src/settings.js";

afterEach(() => {
  resetActiveTuiConfig();
});

describe("prompt prefix and rounded corners", () => {
  it("uses a single custom prompt char and renders rounded box corners", () => {
    setActiveTuiConfig({ ...DEFAULT_TUI_CONFIG, promptChar: "$" });
    const config = loadModalConfig(
      mkdtempSync(join(tmpdir(), "prompt-prefix-")),
    );
    const editor = new ModalEditor(
      {
        requestRender: vi.fn(),
        terminal: { rows: 24, columns: 80, write: vi.fn() },
      } as never,
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

  it("renders a shared chevron in every editor mode", () => {
    const editor = new ModalEditor(
      {
        requestRender: vi.fn(),
        terminal: { rows: 24, columns: 80, write: vi.fn() },
      } as never,
      { borderColor: (s: string) => s, selectList: {} } as never,
      { matches: vi.fn(() => false) } as never,
      { initialMode: "insert" },
    );
    expect(editor.getPromptChar()).toBe("❯");
    editor.setMode("normal");
    expect(editor.getPromptChar()).toBe("❯");
  });

  it("an invalid borderStyle is diagnosed and falls back to rounded", () => {
    const dir = mkdtempSync(join(tmpdir(), "prompt-prefix-and-corners-modal-"));
    writeFileSync(
      join(dir, "modal.json"),
      JSON.stringify({ borderStyle: "sunken" }),
    );
    const diagnostics: string[] = [];
    const config = loadModalConfig(dir, (message) => diagnostics.push(message));
    expect(config.borderStyle).toBe("rounded");
    expect(config.borderStyleExplicit).not.toBe(true);
    expect(
      diagnostics.some((message) => message.includes("borderStyle must be")),
    ).toBe(true);
  });

  it("every border style maps to glyphs and unknown styles default to rounded", () => {
    expect(getBorderChars("double").topLeft).toBe("╔");
    expect(getBorderChars("dashed")).toMatchObject({
      topLeft: "┌",
      topRight: "┐",
      bottomLeft: "└",
      bottomRight: "┘",
      horizontal: "┄",
      vertical: "┆",
    });
    expect(getBorderChars("dotted")).toMatchObject({
      topLeft: "┌",
      topRight: "┐",
      bottomLeft: "└",
      bottomRight: "┘",
      horizontal: "┈",
      vertical: "┊",
    });
    expect(getBorderChars("none").topLeft).toBe("");
    expect(getBorderChars("mystery")).toEqual(getBorderChars("rounded"));
  });
});
