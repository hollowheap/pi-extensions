import {
  rgbColor,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
  createWorkingIndicator,
  crushWorkingIndicator,
} from "../src/spinner.js";

const theme = {
  colors: {
    accent: rgbColor(80, 120, 255),
    borderAccent: rgbColor(80, 220, 255),
    success: rgbColor(80, 220, 120),
    warning: rgbColor(255, 200, 80),
    error: rgbColor(255, 80, 80),
    thinkingText: rgbColor(200, 120, 255),
    text: rgbColor(230, 230, 230),
    muted: rgbColor(120, 120, 120),
  },
  getColorMode: () => "truecolor" as const,
};

describe("crushWorkingIndicator", () => {
  it("produces 32 breathing gradient frames of width 8", () => {
    const indicator = crushWorkingIndicator(theme);
    expect(indicator.intervalMs).toBe(50);
    expect(indicator.frames).toHaveLength(32);
    for (const frame of indicator.frames) {
      expect(visibleWidth(frame)).toBe(8);
      expect(stripTerminalSequences(frame)).toMatch(/^[0-9a-f~!@#$%^&*]{8}$/);
    }
  });

  it("supports presets and monochrome mode via createWorkingIndicator", () => {
    expect(createWorkingIndicator("host", theme)).toBeUndefined();
    expect(createWorkingIndicator("hidden", theme)?.frames).toEqual([]);
    const mono = createWorkingIndicator("crush", theme, false);
    expect(mono?.frames[0]).not.toContain("\x1b[");
    expect(mono?.frames[0]).toMatch(/^[0-9a-f~!@#$%^&*]{8}$/);
    const braille = createWorkingIndicator("braille", theme, true);
    expect(braille?.frames).toHaveLength(10);
    expect(braille?.frames[0]).toContain("\x1b[");
    const monoBars = createWorkingIndicator("bars", theme, false);
    expect(monoBars?.frames).toHaveLength(14);
    expect(monoBars?.frames[0]).toBe("▁▂▃▄");
  });

  it("supports the claude popping preset and color/fade options", () => {
    const claudeMono = createWorkingIndicator("claude", theme, false);
    expect(claudeMono?.intervalMs).toBe(100);
    expect(claudeMono?.frames).toEqual([
      "·",
      "✢",
      "✳",
      "✶",
      "✻",
      "✽",
      "✻",
      "✶",
      "✳",
      "✢",
    ]);

    const claudeFade = createWorkingIndicator("claude", theme, true, {
      color: "accent",
      fade: true,
    });
    const claudeSolid = createWorkingIndicator("claude", theme, true, {
      color: "accent",
      fade: false,
    });
    expect(claudeFade?.frames).toHaveLength(10);
    expect(claudeFade?.frames[0]).not.toBe(claudeSolid?.frames[0]);
    expect(stripTerminalSequences(claudeFade?.frames[5] ?? "")).toBe("✽");
    expect(claudeFade?.frames[5]).toBe(claudeSolid?.frames[5]);

    const crushSolid = createWorkingIndicator("crush", theme, true, {
      color: "success",
      fade: false,
    });
    const crushFade = createWorkingIndicator("crush", theme, true, {
      color: "success",
      fade: true,
    });
    expect(crushSolid?.frames[0]).not.toBe(crushFade?.frames[0]);
  });
});
