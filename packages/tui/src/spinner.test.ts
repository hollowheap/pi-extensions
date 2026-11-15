import {
  rgbColor,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { crushWorkingIndicator } from "./spinner.js";

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
});
