import { describe, expect, it, vi } from "vitest";
import { ModalEditor } from "../src/editor.js";

function createEditor(text: string): ModalEditor {
  const tui = {
    requestRender: vi.fn(),
    terminal: { rows: 24, columns: 80, write: vi.fn() },
  };
  const theme = {
    borderColor: (value: string) => value,
    selectList: {
      selectedPrefix: (value: string) => value,
      selectedText: (value: string) => value,
      description: (value: string) => value,
      scrollInfo: (value: string) => value,
    },
  };
  const editor = new ModalEditor(
    tui as never,
    theme as never,
    { matches: vi.fn(() => false) } as never,
    { initialMode: "insert", borderStyle: "rounded" },
  );
  editor.setText(text);
  return editor;
}

describe("modal prompt layout", () => {
  it("keeps wrapped text when the right border is drawn", () => {
    const rows = createEditor("0123456789ABCDEFGHIJ0123456789").render(20);

    expect(rows[2]).toContain("HIJ0123456789");
  });
});
