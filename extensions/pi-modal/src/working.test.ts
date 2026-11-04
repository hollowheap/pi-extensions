import {
  rgbColor,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { crushWorkingIndicator } from "./working.js";

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
  it("interpolates a seven-stop theme-color breathing gradient", () => {
    const indicator = crushWorkingIndicator(theme);
    expect(indicator.intervalMs).toBe(50);
    expect(indicator.frames).toHaveLength(32);
    for (const frame of indicator.frames) {
      expect(visibleWidth(frame)).toBe(8);
      expect(stripTerminalSequences(frame)).toMatch(/^[0-9a-f~!@#$%^&*]{8}$/);
      expect(frame).toContain("\x1b[38;2;");
      expect(frame).not.toContain("\x1b[38;5;");
    }
    expect(new Set(indicator.frames).size).toBeGreaterThan(1);

    const redChannels = indicator.frames.map((frame) =>
      Number(frame.match(/38;2;(\d+);/)?.[1] ?? 0),
    );
    expect(new Set(redChannels).size).toBeGreaterThan(4);
  });

  it("follows theme color changes", () => {
    const base = crushWorkingIndicator(theme).frames[0];
    const changed = crushWorkingIndicator({
      ...theme,
      colors: { ...theme.colors, accent: rgbColor(0, 255, 0) },
    }).frames[0];
    expect(changed).not.toBe(base);
  });

  it("quantizes the interpolated gradient for 256-color terminals", () => {
    const indicator = crushWorkingIndicator({
      ...theme,
      getColorMode: () => "256color" as const,
    });
    expect(indicator.frames[0]).toContain("\x1b[38;5;");
    expect(indicator.frames[0]).not.toContain("\x1b[38;2;");
  });
});
