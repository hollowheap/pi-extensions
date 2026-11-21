import {
  SkillInvocationMessageComponent,
  initTheme,
  parseSkillBlock,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { getBorderChars } from "@hollowheap/core/border";
import { DEFAULT_TUI_CONFIG } from "@hollowheap/core/tui-config";
import { resetActiveTuiConfig, setActiveTuiConfig } from "@hollowheap/ui/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { paintBorderRow } from "../src/editor.js";
import {
  createHostPanelStyleState,
  formatBoldCustomMessageLabel,
  installSkillPanel,
} from "../src/skill-panel.js";
import { formatSkillBlock } from "../src/skills.js";

class HostStyleTarget {
  paddingX = 2;
  paddingY = 3;
  bgFn: unknown = () => "host";

  setPaddingX(value: number): void {
    this.paddingX = value;
  }

  setBgFn(value: never): void {
    this.bgFn = value;
  }
}

afterEach(() => {
  resetActiveTuiConfig();
});

describe("createHostPanelStyleState", () => {
  it("captures host styles before panel overrides and restores them", () => {
    const state = createHostPanelStyleState<HostStyleTarget>();
    const target = new HostStyleTarget();
    const hostBgFn = target.bgFn;
    state.setOutputPad(target, 4);
    state.capture(target);

    target.setPaddingX(0);
    Reflect.set(target, "paddingY", 0);
    target.setBgFn(undefined as never);

    expect(state.getOutputPad(target)).toBe(4);
    state.restore(target);
    expect(target.paddingX).toBe(4);
    expect(target.paddingY).toBe(3);
    expect(target.bgFn).toBe(hostBgFn);
  });

  it("uses defaults for missing host values and keeps the first capture", () => {
    const state = createHostPanelStyleState<HostStyleTarget>();
    const target = new HostStyleTarget();
    Reflect.deleteProperty(target, "paddingY");
    Reflect.deleteProperty(target, "bgFn");
    state.capture(target);

    target.paddingX = 7;
    Reflect.set(target, "paddingY", 9);
    state.restore(target);

    expect(target.paddingX).toBe(2);
    expect(target.paddingY).toBe(1);
    expect(target.bgFn).toBeUndefined();
    expect(state.getOutputPad(target)).toBe(2);
  });
});

describe("formatBoldCustomMessageLabel", () => {
  it("wraps the label in bold and colors it with customMessageLabel", () => {
    const theme = {
      fg: (token: string, value: string) => `<${token}>${value}</>`,
    } as never;

    expect(formatBoldCustomMessageLabel(theme, "[notice]", true)).toBe(
      "<customMessageLabel>\x1b[1m[notice]\x1b[22m</>",
    );
    expect(formatBoldCustomMessageLabel(theme, "[notice]", false)).toBe(
      "\x1b[1m[notice]\x1b[22m",
    );
    expect(formatBoldCustomMessageLabel(undefined, "[notice]", true)).toBe(
      "\x1b[1m[notice]\x1b[22m",
    );
  });
});

describe("skill panel host styles", () => {
  it("restores host padding and background when panels are disabled", () => {
    initTheme("dark");
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      panel: { ...DEFAULT_TUI_CONFIG.panel, enabled: false },
    });
    installSkillPanel(() => undefined);
    const block = parseSkillBlock(
      formatSkillBlock(
        "alpha",
        "/skills/alpha/SKILL.md",
        "/skills/alpha",
        "Alpha instructions",
      ),
    );
    if (!block) throw new Error("Expected Pi to parse the skill block");
    const component = new SkillInvocationMessageComponent(block, undefined, 2);
    expect(Reflect.get(component, "paddingX")).toBe(2);

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      panel: {
        ...DEFAULT_TUI_CONFIG.panel,
        enabled: true,
        borderStyle: "square",
      },
    });
    component.invalidate();
    expect(Reflect.get(component, "paddingX")).toBe(0);
    expect(Reflect.get(component, "paddingY")).toBe(0);
    expect(Reflect.get(component, "bgFn")).toBeUndefined();
    expect(stripTerminalSequences(component.render(40)[0] ?? "")).toBe(
      `┌${"─".repeat(38)}┐`,
    );

    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      panel: { ...DEFAULT_TUI_CONFIG.panel, enabled: false },
    });
    component.invalidate();
    expect(Reflect.get(component, "paddingX")).toBe(2);
    expect(Reflect.get(component, "paddingY")).toBe(1);
    expect(typeof Reflect.get(component, "bgFn")).toBe("function");
  });
});

describe("paintBorderRow", () => {
  it("paints the inner line and corners with the selected border chars", () => {
    const borderChars = getBorderChars("double");
    const renderInner = vi.fn(
      (innerWidth: number) =>
        `─${"\x1b[31m─\x1b[0m".repeat(Math.max(0, innerWidth - 1))}`,
    );

    const line = paintBorderRow({
      width: 8,
      borderChars,
      paint: (text) => `<p:${text}>`,
      leftCorner: borderChars.topLeft,
      rightCorner: borderChars.topRight,
      renderInner,
    });

    expect(renderInner).toHaveBeenCalledWith(6);
    expect(line).toBe("<p:╔><p:══════><p:╗>");
  });

  it("fits a label on the right and skips inner rendering when too narrow", () => {
    const borderChars = getBorderChars("sharp");
    const renderInner = vi.fn((innerWidth: number) => "─".repeat(innerWidth));

    const labeled = paintBorderRow({
      width: 8,
      borderChars,
      paint: (text) => text,
      leftCorner: borderChars.bottomLeft,
      rightCorner: borderChars.bottomRight,
      renderInner,
      label: " N ",
    });
    expect(renderInner).toHaveBeenCalledWith(6);
    expect(stripTerminalSequences(labeled)).toBe("└─── N ┘");

    const narrowRenderInner = vi.fn(() => "─");
    const narrow = paintBorderRow({
      width: 2,
      borderChars,
      paint: (text) => text,
      leftCorner: borderChars.topLeft,
      rightCorner: borderChars.topRight,
      renderInner: narrowRenderInner,
      label: "X",
    });
    expect(narrow).toBe("┌┐");
    expect(narrowRenderInner).not.toHaveBeenCalled();
  });
});
