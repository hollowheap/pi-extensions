import { DEFAULT_TUI_CONFIG } from "@hollowheap/core/tui-config";
import { resetActiveTuiConfig, setActiveTuiConfig } from "@hollowheap/ui/state";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  ExtensionInputComponent: class {
    render() {
      return ["────────", " Ask", "", "────────"];
    }
  },
}));

const theme = {
  fg: (_token: string, value: string) => value,
  bg: (_token: string, value: string) => value,
  bold: (value: string) => value,
} as never;

afterEach(() => {
  resetActiveTuiConfig();
});

describe("host input panel", () => {
  it("uses the shared panel border override", async () => {
    const { ExtensionInputComponent } = await import(
      "@earendil-works/pi-coding-agent"
    );
    const { installExtensionInputPanel } = await import(
      "../src/input-panel.js"
    );
    installExtensionInputPanel(() => theme);
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      borderStyle: "rounded",
      panel: { ...DEFAULT_TUI_CONFIG.panel, borderStyle: "double" },
    });
    const input = new ExtensionInputComponent(
      "Ask",
      undefined,
      () => {},
      () => {},
    );
    expect(input.render(40)[0]?.startsWith("╔═")).toBe(true);
  });
});
