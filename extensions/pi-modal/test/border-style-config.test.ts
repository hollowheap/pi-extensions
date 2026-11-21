import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TUI_CONFIG } from "@hollowheap/core/tui-config";
import { resetActiveTuiConfig, setActiveTuiConfig } from "@hollowheap/ui/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModalEditor } from "../src/editor.js";
import { loadModalConfig } from "../src/settings.js";

afterEach(() => {
  resetActiveTuiConfig();
});

describe("border style configuration", () => {
  it("falls back to rounded and diagnoses an unknown borderStyle", () => {
    const dir = mkdtempSync(join(tmpdir(), "border-style-config-modal-"));
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

  it("a missing config file yields defaults without diagnostics", () => {
    const dir = mkdtempSync(join(tmpdir(), "border-style-config-missing-"));
    const diagnostics: string[] = [];
    const config = loadModalConfig(dir, (message) => diagnostics.push(message));
    expect(diagnostics).toEqual([]);
    expect(config.borderStyle).toBe("rounded");
    expect(config.initialMode).toBe("insert");
  });

  it("malformed JSON is diagnosed and defaults are kept", () => {
    const dir = mkdtempSync(join(tmpdir(), "border-style-config-malformed-"));
    writeFileSync(join(dir, "modal.json"), "{not json");
    const diagnostics: string[] = [];
    const config = loadModalConfig(dir, (message) => diagnostics.push(message));
    expect(diagnostics[0]).toContain("cannot read modal.json");
    expect(config.borderStyle).toBe("rounded");
  });

  it("loaded prompt and keymap settings reach the editor", () => {
    const dir = mkdtempSync(join(tmpdir(), "border-style-config-consumer-"));
    writeFileSync(
      join(dir, "modal.json"),
      JSON.stringify({
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
    setActiveTuiConfig({ ...DEFAULT_TUI_CONFIG, promptChar: "»" });
    expect(editor.getPromptChar()).toBe("»");
    expect(editor.getKeymaps().normal.j).toBe("down");
  });
});
