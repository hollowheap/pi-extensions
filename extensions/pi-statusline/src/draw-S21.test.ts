import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "./config.js";
import { renderStatusline } from "./render.js";

function context() {
  return {
    cwd: "/home/u/app",
    homeDir: "/home/u",
    modelId: "m",
    branch: "main",
    tokens: { input: 0, output: 0, cost: 0 },
    contextPercent: null,
    busy: false,
    now: new Date(2026, 9, 12, 12, 0, 0),
    gitDiff: undefined,
  };
}

function theme(): Theme {
  return { style: (text: string) => text } as unknown as Theme;
}

describe("S21: statusline component and pill pipeline", () => {
  it("renders extension pills and truncates left text before right-pinned sections", () => {
    const config = defaultConfig();
    config.extensions = ["mode-guard"];
    config.sections = {
      a: [
        { type: "mode", accent: "accent", icon: "󰘧" },
        { type: "mode-guard", accent: "accent" },
      ],
      z: [{ type: "text", text: "RIGHT" }],
    };
    const line = renderStatusline(
      12,
      config,
      context(),
      theme(),
      new Map([["mode-guard", "PLAN"]]),
    );
    expect(line).toContain("RIGHT");
    expect(visibleWidth(line)).toBeLessThanOrEqual(12);

    const pills = renderStatusline(
      40,
      config,
      context(),
      theme(),
      new Map([["mode-guard", "PLAN"]]),
    );
    expect(pills).toContain("\uE0B6");
    expect(pills).toContain("\uE0B4");
    expect(pills).toContain("PLAN");
  });
});
