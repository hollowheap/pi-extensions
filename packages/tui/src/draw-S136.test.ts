import { rgbColor, stripTerminalSequences } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { createWorkingIndicator } from "./spinner.js";

describe("S136 animated working indicator", () => {
  it("provides animated frames for braille and no frames when hidden", () => {
    const animated = createWorkingIndicator("braille", undefined, false);
    const hidden = createWorkingIndicator("hidden", undefined, false);

    expect(animated?.frames.length).toBeGreaterThan(1);
    expect(new Set(animated?.frames).size).toBeGreaterThan(1);
    expect(animated?.intervalMs).toBeGreaterThan(0);
    expect(hidden?.frames).toEqual([]);
  });

  it("S136 C02: host defers to the host while each preset has its own cadence", () => {
    expect(createWorkingIndicator("host", undefined, false)).toBeUndefined();
    const hidden = createWorkingIndicator("hidden", undefined, false);
    const pulse = createWorkingIndicator("pulse", undefined, false);
    expect(hidden?.intervalMs).toBe(1_000);
    expect(pulse?.intervalMs).toBe(120);
    expect(pulse?.frames).toEqual(["∙", "•", "●", "◉", "●", "•"]);
  });

  it("S136 C03: an unknown style falls back to braille frames", () => {
    const fallback = createWorkingIndicator(
      "unlisted-style" as never,
      undefined,
      false,
    );
    const braille = createWorkingIndicator("braille", undefined, false);
    expect(fallback?.frames).toEqual(braille?.frames);
    expect(fallback?.intervalMs).toBe(80);
  });

  it("S136 C04: a working theme drives the gradient indicator and color mode", () => {
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
    const colored = createWorkingIndicator("crush", theme, true);
    const plain = createWorkingIndicator("crush", theme, false);
    expect(colored?.frames).toHaveLength(32);
    expect(colored?.intervalMs).toBe(50);
    expect(colored?.frames[0]).toContain("\x1b[");
    expect(plain?.frames).toHaveLength(32);
    expect(stripTerminalSequences(plain?.frames[0] ?? "")).toMatch(
      /^[0-9a-f~!@#$%^&*]{8}$/,
    );
  });
});
