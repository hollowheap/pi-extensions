import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { BUILTINS } from "./components.js";
import { defaultConfig, normalizeConfig } from "./config.js";
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

describe("S21: left-only truncation, component failure and config-to-render flow", () => {
  it("S21 C02: left-only sections are truncated to the requested width", () => {
    const config = defaultConfig();
    config.sections = { a: [{ type: "text", text: "LEFT-CONTENT-LONG" }] };
    const line = renderStatusline(6, config, context(), theme());
    expect(line).toContain("LEF");
    expect(visibleWidth(line)).toBeLessThanOrEqual(6);

    const empty = renderStatusline(
      10,
      { ...config, sections: {} },
      context(),
      theme(),
    );
    expect(empty).toBe("");
  });

  it("S21 C03: a throwing component reports one diagnostic and rendering continues", () => {
    Reflect.set(BUILTINS, "draw-s21-throw", () => {
      throw new Error("component boom");
    });
    try {
      const config = defaultConfig();
      config.sections = {
        a: [{ type: "draw-s21-throw" }, { type: "text", text: "OK" }],
        z: [{ type: "text", text: "RIGHT" }],
      };
      const diagnostics: string[] = [];
      const line = renderStatusline(
        30,
        config,
        context(),
        theme(),
        new Map(),
        (message) => diagnostics.push(message),
      );
      expect(line).toContain("OK");
      expect(line).toContain("RIGHT");
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toContain("draw-s21-throw");
    } finally {
      Reflect.deleteProperty(BUILTINS, "draw-s21-throw");
    }
  });

  it("S21 C04: a normalized config renders its configured sections", () => {
    const { config, diagnostics } = normalizeConfig({
      extensions: [],
      sections: {
        a: [{ type: "text", text: "LEFT" }],
        z: [{ type: "text", text: "RIGHT" }],
      },
    });
    expect(diagnostics).toEqual([]);
    const line = renderStatusline(20, config, context(), theme());
    expect(line).toContain("LEFT");
    expect(line).toContain("RIGHT");
    expect(visibleWidth(line)).toBeLessThanOrEqual(20);
  });
});
