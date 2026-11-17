import {
  rgbColor,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import {
  SHIMMER_BASE_INTERVAL_MS,
  createThinkingShimmerAnimator,
  formatOneLineThinkingText,
  renderThinkingShimmerFrame,
  shimmerSpeed,
  stripMarkdownInline,
} from "./thinking.js";

const theme = {
  colors: {
    accent: rgbColor(80, 180, 255),
    borderAccent: rgbColor(80, 230, 255),
    success: rgbColor(80, 220, 120),
    warning: rgbColor(255, 200, 80),
    error: rgbColor(255, 80, 80),
    thinkingText: rgbColor(150, 140, 190),
    text: rgbColor(230, 230, 230),
    muted: rgbColor(120, 120, 120),
  },
  getColorMode: () => "truecolor" as const,
};

describe("thinking display helpers", () => {
  it("formats multi-line thinking text into one truncated line", () => {
    const raw =
      "\x1b[31mStep 1\x1b[0m: inspect\n\nChecking the border code in editor.ts";
    const latest = formatOneLineThinkingText(raw, 28, { pick: "latest" });
    expect(latest).not.toContain("\n");
    expect(visibleWidth(latest)).toBeLessThanOrEqual(28);
    expect(latest).toContain("Checking");

    const first = formatOneLineThinkingText(raw, 28, { pick: "first" });
    expect(first).toContain("Step 1");
    expect(visibleWidth(first)).toBeLessThanOrEqual(28);
  });

  it("renders a scrolling color shimmer without changing visible text", () => {
    const line = "Thinking: checking layout";
    const f0 = renderThinkingShimmerFrame(line, 0, theme, true);
    const f5 = renderThinkingShimmerFrame(line, 5, theme, true);
    expect(stripTerminalSequences(f0)).toBe(line);
    expect(stripTerminalSequences(f5)).toBe(line);
    expect(f0).toContain("\x1b[38;");
    expect(f0).not.toContain("\x1b[0m");
    expect(f0).not.toBe(f5);
  });

  it("returns plain text when colored is false", () => {
    const line = "Thinking: checking layout";
    expect(renderThinkingShimmerFrame(line, 4, theme, false)).toBe(line);
  });

  it("accelerates the shimmer for longer lines and starts faster", () => {
    expect(SHIMMER_BASE_INTERVAL_MS).toBe(45);
    expect(shimmerSpeed(0)).toBe(1);
    expect(shimmerSpeed(120)).toBe(3);
    expect(shimmerSpeed(10_000)).toBe(6);
  });

  it("animator advances frames and drives redraws until disposed", () => {
    vi.useFakeTimers();
    try {
      const requestRender = vi.fn();
      const animator = createThinkingShimmerAnimator(
        { requestRender },
        { intervalMs: SHIMMER_BASE_INTERVAL_MS },
      );
      const line = "Thinking: checking layout";
      const first = animator.frame(line, theme, true);
      expect(animator.step).toBe(0);
      expect(requestRender).not.toHaveBeenCalled();

      vi.advanceTimersByTime(SHIMMER_BASE_INTERVAL_MS);
      expect(animator.step).toBe(1);
      expect(requestRender).toHaveBeenCalledTimes(1);
      expect(animator.frame(line, theme, true)).not.toBe(first);

      animator.dispose();
      vi.advanceTimersByTime(SHIMMER_BASE_INTERVAL_MS * 5);
      expect(animator.step).toBe(1);
      expect(requestRender).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("strips inline markdown for one-line labels and shimmer spans", () => {
    expect(
      stripMarkdownInline(
        "Inspecting **border** and `clip` in [editor](src/editor.ts) ~~now~~",
      ),
    ).toBe("Inspecting border and clip in editor now");
    expect(stripMarkdownInline("snake_case stays")).toBe("snake_case stays");
    expect(stripMarkdownInline("*emphasis* text")).toBe("emphasis text");
  });
});
