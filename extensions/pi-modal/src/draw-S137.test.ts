import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ModalEditor } from "./editor.js";
import { loadModalConfig } from "./keymap.js";

describe("S137 border style configuration", () => {
  it("falls back to rounded and diagnoses an unknown borderStyle", () => {
    const dir = mkdtempSync(join(tmpdir(), "s137-modal-"));
    writeFileSync(
      join(dir, "modal.json"),
      JSON.stringify({ borderStyle: "fancy" }),
    );
    const diagnostics: string[] = [];

    const config = loadModalConfig(dir, (message) => diagnostics.push(message));

    expect(config.borderStyle).toBe("rounded");
    expect(diagnostics.some((message) => message.includes("borderStyle"))).toBe(
      true,
    );
  });

  it("S137 C02: a missing config file yields defaults without diagnostics", () => {
    const dir = mkdtempSync(join(tmpdir(), "s137-missing-"));
    const diagnostics: string[] = [];
    const config = loadModalConfig(dir, (message) => diagnostics.push(message));
    expect(diagnostics).toEqual([]);
    expect(config.borderStyle).toBe("rounded");
    expect(config.promptChar).toBe("❯");
    expect(config.initialMode).toBe("insert");
  });

  it("S137 C03: malformed JSON is diagnosed and defaults are kept", () => {
    const dir = mkdtempSync(join(tmpdir(), "s137-malformed-"));
    writeFileSync(join(dir, "modal.json"), "{not json");
    const diagnostics: string[] = [];
    const config = loadModalConfig(dir, (message) => diagnostics.push(message));
    expect(diagnostics[0]).toContain("cannot read modal.json");
    expect(config.borderStyle).toBe("rounded");
  });

  it("S137 C04: loaded prompt and keymap settings reach the editor", () => {
    const dir = mkdtempSync(join(tmpdir(), "s137-consumer-"));
    writeFileSync(
      join(dir, "modal.json"),
      JSON.stringify({
        promptChar: "»",
        keymaps: { normal: { j: "down" } },
      }),
    );
    const config = loadModalConfig(dir);
    const editor = new ModalEditor(
      {
        requestRender: vi.fn(),
        terminal: { rows: 24, columns: 80, write: vi.fn() },
      } as never,
      {
        borderColor: (text: string) => text,
        selectList: {
          selectedPrefix: (text: string) => text,
          selectedText: (text: string) => text,
          description: (text: string) => text,
          scrollInfo: (text: string) => text,
        },
      } as never,
      { matches: vi.fn(() => false) } as never,
      config,
    );
    expect(editor.getPromptChar()).toBe("»");
    expect(editor.getKeymaps().normal.j).toBe("down");
  });
});
