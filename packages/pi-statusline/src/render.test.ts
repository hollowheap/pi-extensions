import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { ComponentContext } from "./components.js";
import { defaultConfig, normalizeConfig } from "./config.js";
import { renderStatusline } from "./render.js";

function ctx(overrides: Partial<ComponentContext> = {}): ComponentContext {
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
    ...overrides,
  };
}

function theme(style: (text: string) => string = (text) => text): Theme {
  return { style } as unknown as Theme;
}

describe("renderStatusline", () => {
  it("pins left sections to the start and right sections to the end", () => {
    const config = defaultConfig();
    config.sections = {
      a: [{ type: "text", text: "L" }],
      z: [{ type: "text", text: "R" }],
    };
    const line = renderStatusline(10, config, ctx(), theme());
    expect(line).toBe("L        R");
    expect(visibleWidth(line)).toBe(10);
  });

  it("orders sections alphabetically within each side", () => {
    const config = defaultConfig();
    config.sections = {
      b: [{ type: "text", text: "b" }],
      a: [{ type: "text", text: "a" }],
      z: [{ type: "text", text: "z" }],
      y: [{ type: "text", text: "y" }],
    };
    expect(
      renderStatusline(20, config, ctx(), theme()).replace(/ +/g, " "),
    ).toBe("a b y z");
  });

  it("renders only the left side when no right sections exist", () => {
    const config = defaultConfig();
    config.sections = { a: [{ type: "text", text: "L" }] };
    expect(renderStatusline(10, config, ctx(), theme())).toBe("L");
  });

  it("right-aligns when only right sections exist", () => {
    const config = defaultConfig();
    config.sections = { z: [{ type: "text", text: "R" }] };
    expect(renderStatusline(10, config, ctx(), theme())).toBe("         R");
  });

  it("skips empty components and empty sections", () => {
    const config = defaultConfig();
    config.sections = {
      a: [{ type: "git_branch" }, { type: "text", text: "L" }],
      m: [{ type: "git_branch" }],
      z: [{ type: "text", text: "R" }],
    };
    expect(renderStatusline(10, config, ctx({ branch: null }), theme())).toBe(
      "L        R",
    );
  });

  it("truncates narrow widths without exceeding them", () => {
    const config = defaultConfig();
    config.sections = {
      a: [{ type: "text", text: "left-long" }],
      z: [{ type: "text", text: "right-long" }],
    };
    const line = renderStatusline(8, config, ctx(), theme());
    expect(visibleWidth(line)).toBeLessThanOrEqual(8);
  });

  it("styles separators through the theme", () => {
    const config = defaultConfig();
    config.sections = {
      a: [
        { type: "text", text: "L1" },
        { type: "text", text: "L2" },
      ],
      b: [{ type: "text", text: "B" }],
      z: [{ type: "text", text: "R" }],
    };
    config.options.componentSeparator = { text: "|", fg: "dim" };
    config.options.sectionSeparator = {
      text: " / ",
      bg: "selectedBg",
      bold: true,
    };
    const style = vi.fn((text: string) => `[${text}]`);
    const line = renderStatusline(40, config, ctx(), theme(style));
    expect(style).toHaveBeenCalledWith("|", { fg: "dim" });
    expect(style).toHaveBeenCalledWith(" / ", {
      bg: "selectedBg",
      bold: true,
    });
    expect(line).toContain("[|]");
    expect(line).toContain("[ / ]");
  });

  it("skips theme styling for plain separators", () => {
    const config = defaultConfig();
    config.sections = {
      a: [
        { type: "text", text: "L1" },
        { type: "text", text: "L2" },
      ],
      z: [{ type: "text", text: "R" }],
    };
    const style = vi.fn((text: string) => `[${text}]`);
    renderStatusline(40, config, ctx(), theme(style));
    expect(style).not.toHaveBeenCalled();
  });

  it("styles components carrying fg, bg, or bold", () => {
    const config = defaultConfig();
    config.sections = {
      a: [{ type: "text", text: "L", fg: "dim" }],
      z: [{ type: "text", text: "R" }],
    };
    const style = vi.fn((text: string) => `[${text}]`);
    const line = renderStatusline(10, config, ctx(), theme(style));
    expect(style).toHaveBeenCalledWith("L", { fg: "dim" });
    expect(line).toContain("[L]");
  });

  it("renders pills with caps and skips empty components cleanly", () => {
    const { config } = normalizeConfig({
      sections: {
        a: [{ type: "mode", accent: "bright-yellow", icon: "󰘧" }],
        b: [{ type: "git_branch", accent: "bright-cyan", icon: "" }],
      },
    });
    const style = vi.fn((text: string) => `[${text}]`);
    const withBranch = renderStatusline(40, config, ctx({ branch: "feat" }), theme(style));
    expect(withBranch).toContain("[][󰘧 ][ IDLE ][]");
    expect(withBranch).toContain("[][ ][ feat ][]");

    // When outside git repo, git_branch is null, so no dangling pill caps
    const noBranch = renderStatusline(40, config, ctx({ branch: null }), theme(style));
    expect(noBranch).toContain("[][󰘧 ][ IDLE ][]");
    expect(noBranch).not.toContain("");
  });
});
