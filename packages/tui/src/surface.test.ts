import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetActiveTuiConfig, setActiveTuiConfig } from "./state.js";
import { getSurfaceBgToken, paintSurfaceLine } from "./surface.js";

afterEach(() => {
  resetActiveTuiConfig();
});

describe("surface", () => {
  it("maps overlay surface modes to theme background tokens", () => {
    expect(getSurfaceBgToken("transparent")).toBeUndefined();
    expect(getSurfaceBgToken("surface")).toBe("customMessageBg");
    expect(getSurfaceBgToken("card")).toBe("userMessageBg");
    expect(getSurfaceBgToken("contrast")).toBe("selectedBg");
  });

  it("pads to width and wraps with theme.bg when surface token is active", () => {
    const bg = vi.fn((token: string, text: string) => `[${token}:${text}]`);
    const theme = { bg } as never;

    expect(paintSurfaceLine("hi", 6, theme, "transparent")).toBe("hi    ");
    expect(bg).not.toHaveBeenCalled();

    const card = paintSurfaceLine("hi", 6, theme, "card");
    expect(bg).toHaveBeenCalledWith("userMessageBg", "hi    ");
    expect(card).toBe("[userMessageBg:hi    ]");

    const truncated = paintSurfaceLine("hello world", 5, theme, "contrast");
    expect(stripTerminalSequences(truncated)).toBe("[selectedBg:hello]");
    expect(visibleWidth("hello")).toBe(5);
  });

  it("defaults to active TUI config overlaySurface", () => {
    const current = {
      borderStyle: "rounded" as const,
      overlaySurface: "surface" as const,
      shortMode: false,
      toolBox: {
        enabled: false,
        borderStyle: "rounded" as const,
        accentStripe: true,
        verbPack: "standard" as const,
        outcomeBadges: true,
        reuseSpinner: true,
        customVerbs: {},
      },
    };
    setActiveTuiConfig(current);
    const bg = vi.fn((token: string, text: string) => `[${token}:${text}]`);
    const result = paintSurfaceLine("ok", 4, { bg } as never);
    expect(result).toBe("[customMessageBg:ok  ]");
  });
});
