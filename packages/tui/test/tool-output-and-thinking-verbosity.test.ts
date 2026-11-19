import {
  DEFAULT_TUI_CONFIG,
  THINKING_VERBOSITY_MODES,
  normalizeTuiConfig,
} from "@hollowheap/core/tui-config";
import { describe, expect, it, vi } from "vitest";
import modalExtension from "../../../extensions/pi-modal/src/index.js";

describe("unified collapse and verbosity", () => {
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

  it("invalid verbosity values fall back with diagnostics", () => {
    const diagnostics: string[] = [];
    const config = normalizeTuiConfig(
      { thinkingVerbosity: "bogus", toolVerbosity: "bogus" },
      diagnostics,
    );

    expect(config.thinkingVerbosity).toBe(DEFAULT_TUI_CONFIG.thinkingVerbosity);
    expect(config.toolVerbosity).toBe("medium");
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("legacy display settings and new verbosity modes normalize", () => {
    const legacy = normalizeTuiConfig({ thinkingDisplay: "one-line" });
    expect(legacy.thinkingVerbosity).toBe("minimal");

    const current = normalizeTuiConfig({
      thinkingVerbosity: "high",
      toolVerbosity: "low",
    });
    expect(current.thinkingVerbosity).toBe("high");
    expect(current.toolVerbosity).toBe("low");
  });

  it("shows tool verbosity in /ui status and retires /expand", async () => {
    const pi = {
      on: vi.fn(() => () => {}),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      registerToolRenderer: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn() },
    };
    modalExtension(pi as never);
    const ui = pi.registerCommand.mock.calls.find(
      ([name]) => name === "ui",
    )?.[1] as { handler: (args: string, ctx: unknown) => Promise<void> };

    expect(pi.registerCommand).not.toHaveBeenCalledWith(
      "expand",
      expect.anything(),
    );
    const notify = vi.fn();
    await ui.handler("status", { hasUI: true, ui: { notify } });
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("toolVerbosity=medium"),
      "info",
    );
  });
});
