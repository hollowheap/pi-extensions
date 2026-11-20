import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_TUI_CONFIG } from "@hollowheap/core/tui-config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetActiveTuiConfig, setActiveTuiConfig } from "../src/state.js";
import {
  getSurfaceBgToken,
  paintSurfaceLine,
  stripBackgroundSgr,
} from "../src/surface.js";

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

  it("keeps the surface through resets and preserves extended foreground colors", () => {
    const bg = (_token: string, text: string) => `\x1b[44m${text}\x1b[49m`;
    const line = paintSurfaceLine(
      "│ \x1b[48;5;123;38;2;40;49;107mvalue\x1b[0m │",
      12,
      { bg } as never,
      "card",
    );
    expect(line).not.toContain("48;5;123");
    expect(line).toContain("\x1b[38;2;40;49;107mvalue\x1b[0m\x1b[44m │");
    expect(visibleWidth(line)).toBe(12);
  });

  it("strips bright backgrounds but leaves foreground-only lines untouched", () => {
    const bg = (_token: string, text: string) => `\x1b[44m${text}`;
    const bright = paintSurfaceLine(
      "\x1b[104mvalue\x1b[0m",
      12,
      { bg } as never,
      "card",
    );
    expect(bright).not.toContain("104m");
    expect(bright).toContain("\x1b[44mvalue\x1b[0m\x1b[44m");

    const foregroundOnly = "\x1b[38;2;1;2;3mvalue\x1b[39m";
    expect(stripBackgroundSgr(foregroundOnly, "\x1b[44m")).toBe(foregroundOnly);
  });

  it("defaults to active TUI config overlaySurface and respects colored=false", () => {
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      overlaySurface: "surface",
    });
    const bg = vi.fn((token: string, text: string) => `[${token}:${text}]`);
    const result = paintSurfaceLine("ok", 4, { bg } as never);
    expect(result).toBe("[customMessageBg:ok  ]");

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      overlaySurface: "card",
      colored: false,
    });
    bg.mockClear();
    expect(paintSurfaceLine("ok", 4, { bg } as never)).toBe("ok  ");
    expect(bg).not.toHaveBeenCalled();
  });

  it("restores surfaceAnsi after bare resets and skips re-truncating pre-fitted lines", () => {
    expect(stripBackgroundSgr("\x1b[mreset")).toBe("\x1b[mreset");
    expect(stripBackgroundSgr("\x1b[mreset", "\x1b[44m")).toBe(
      "\x1b[m\x1b[44mreset",
    );
    expect(stripBackgroundSgr("\x1b[;32mvalue", "\x1b[44m")).toBe(
      "\x1b[;32m\x1b[44mvalue",
    );

    const preFitted = "\x1b[34m│\x1b[39m \x1b[32mok\x1b[39m \x1b[34m│\x1b[39m";
    expect(visibleWidth(preFitted)).toBe(6);
    expect(paintSurfaceLine(preFitted, 6, undefined, "transparent")).toBe(
      preFitted,
    );
  });

  it("strips SGR dim when painting on a surface background and keeps it when transparent", () => {
    expect(stripBackgroundSgr("\x1b[2mdim\x1b[0m")).toBe("\x1b[2mdim\x1b[0m");
    expect(stripBackgroundSgr("\x1b[2mdim\x1b[0m", "\x1b[44m")).toBe(
      "dim\x1b[0m\x1b[44m",
    );
  });
});
