import {
  DEFAULT_TUI_CONFIG,
  THINKING_VERBOSITY_MODES,
} from "@hollowheap/core/tui-config";
import { describe, expect, it, vi } from "vitest";
import modalExtension from "../../../extensions/pi-modal/src/index.js";

describe("S219 unified collapse and verbosity", () => {
  it("uses low/medium/high thinking verbosity levels", () => {
    expect([...THINKING_VERBOSITY_MODES]).toEqual(["low", "medium", "high"]);
  });

  it("has a separate tool verbosity setting defaulting to medium", () => {
    expect(
      (DEFAULT_TUI_CONFIG as unknown as Record<string, unknown>).toolVerbosity,
    ).toBe("medium");
  });

  it("retires the host ctrl+shift+o tool toggle shortcut", () => {
    const pi = {
      on: vi.fn(() => () => {}),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      registerToolRenderer: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn() },
    };
    modalExtension(pi as never);

    const shortcuts = pi.registerShortcut.mock.calls.map(([name]) => name);
    expect(shortcuts).not.toContain("ctrl+shift+o");
  });
});
