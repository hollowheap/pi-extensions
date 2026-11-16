import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  type SettingItem,
  SettingsList,
  type SettingsListTheme,
} from "@earendil-works/pi-tui";
import { BORDER_STYLES, type BorderStyle } from "@hollowheap/core/border";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import {
  LOADING_INDICATOR_STYLES,
  type LoadingIndicatorStyle,
  OVERLAY_SURFACE_MODES,
  type OverlaySurfaceMode,
  THINKING_DISPLAY_MODES,
  TOOL_VERB_PACKS,
  type ThinkingDisplayMode,
  type ToolVerbPack,
  type TuiConfig,
  updateTuiConfig,
} from "@hollowheap/core/tui-config";
import { roundedFrame } from "@hollowheap/tui/frame";
import { getActiveTuiConfig, setActiveTuiConfig } from "@hollowheap/tui/state";

function settingsTheme(theme: Theme, colored: boolean): SettingsListTheme {
  const fg = (token: Parameters<Theme["fg"]>[0], text: string) =>
    colored ? theme.fg(token, text) : text;
  return {
    label: (text, selected) =>
      selected ? fg("accent", text) : fg("text", text),
    value: (text, selected) =>
      selected ? fg("accent", text) : fg("muted", text),
    description: (text) => fg("muted", text),
    cursor: fg("accent", "› "),
    hint: (text) => fg("dim", text),
  };
}

function applyTuiSetting(
  current: TuiConfig,
  id: string,
  value: string,
): TuiConfig {
  const next: TuiConfig = {
    ...current,
    toolBox: {
      ...current.toolBox,
      customVerbs: { ...current.toolBox.customVerbs },
    },
  };
  switch (id) {
    case "borderStyle":
      next.borderStyle = value as BorderStyle;
      break;
    case "colored":
      next.colored = value === "true";
      break;
    case "overlaySurface":
      next.overlaySurface = value as OverlaySurfaceMode;
      break;
    case "loadingIndicator":
      next.loadingIndicator = value as LoadingIndicatorStyle;
      break;
    case "markdownRender":
      next.markdownRender = value === "true";
      break;
    case "thinkingDisplay":
      next.thinkingDisplay = value as ThinkingDisplayMode;
      break;
    case "thinkingAnimate":
      next.thinkingAnimate = value === "true";
      break;
    case "toolBox.enabled":
      next.toolBox.enabled = value === "true";
      break;
    case "toolBox.borderStyle":
      next.toolBox.borderStyle = value as BorderStyle;
      break;
    case "toolBox.accentStripe":
      next.toolBox.accentStripe = value === "true";
      break;
    case "toolBox.verbPack":
      next.toolBox.verbPack = value as ToolVerbPack;
      break;
    case "toolBox.outcomeBadges":
      next.toolBox.outcomeBadges = value === "true";
      break;
    case "toolBox.reuseSpinner":
      next.toolBox.reuseSpinner = value === "true";
      break;
  }
  return next;
}

function buildSettingItems(config: TuiConfig): SettingItem[] {
  return [
    {
      id: "borderStyle",
      label: "Border style",
      description: "Frame border style for overlays and editor",
      currentValue: config.borderStyle,
      values: [...BORDER_STYLES],
    },
    {
      id: "colored",
      label: "Colored UI",
      description: "Enable theme foreground, surface, and spinner colors",
      currentValue: String(config.colored),
      values: ["true", "false"],
    },
    {
      id: "overlaySurface",
      label: "Overlay surface",
      description: "Background surface fill for TUI overlays",
      currentValue: config.overlaySurface,
      values: [...OVERLAY_SURFACE_MODES],
    },
    {
      id: "loadingIndicator",
      label: "Loading indicator",
      description: "Working spinner preset for status and tool boxes",
      currentValue: config.loadingIndicator,
      values: [...LOADING_INDICATOR_STYLES],
    },
    {
      id: "markdownRender",
      label: "Markdown dividers",
      description: "Normalize --- and === into rendered Markdown rules",
      currentValue: String(config.markdownRender),
      values: ["true", "false"],
    },
    {
      id: "thinkingDisplay",
      label: "Thinking display",
      description: "Full Markdown or truncated single-line thinking preview",
      currentValue: config.thinkingDisplay,
      values: [...THINKING_DISPLAY_MODES],
    },
    {
      id: "thinkingAnimate",
      label: "Thinking shimmer",
      description: "Animate scrolling color sweep across one-line thinking",
      currentValue: String(config.thinkingAnimate),
      values: ["true", "false"],
    },
    {
      id: "toolBox.enabled",
      label: "Tool box renderer",
      description: "Wrap tool calls in a configurable self-rendered box",
      currentValue: String(config.toolBox.enabled),
      values: ["false", "true"],
    },
    {
      id: "toolBox.borderStyle",
      label: "Tool box border",
      description: "Border style used by the tool box renderer",
      currentValue: config.toolBox.borderStyle,
      values: [...BORDER_STYLES],
    },
    {
      id: "toolBox.accentStripe",
      label: "Tool box accent stripe",
      description: "Show left state stripe on tool boxes",
      currentValue: String(config.toolBox.accentStripe),
      values: ["true", "false"],
    },
    {
      id: "toolBox.verbPack",
      label: "Tool box verb pack",
      description: "Action verb style for tool calls",
      currentValue: config.toolBox.verbPack,
      values: [...TOOL_VERB_PACKS],
    },
    {
      id: "toolBox.outcomeBadges",
      label: "Tool box outcome badges",
      description: "Show ✓/✗ and execution duration badges when settled",
      currentValue: String(config.toolBox.outcomeBadges),
      values: ["true", "false"],
    },
    {
      id: "toolBox.reuseSpinner",
      label: "Tool box spinner",
      description: "Reuse gradient spinner animation while tools run",
      currentValue: String(config.toolBox.reuseSpinner),
      values: ["true", "false"],
    },
  ];
}

export function formatTuiStatus(config: TuiConfig): string {
  return [
    `borderStyle=${config.borderStyle}`,
    `colored=${config.colored}`,
    `overlaySurface=${config.overlaySurface}`,
    `loadingIndicator=${config.loadingIndicator}`,
    `markdownRender=${config.markdownRender}`,
    `thinkingDisplay=${config.thinkingDisplay}`,
    `thinkingAnimate=${config.thinkingAnimate}`,
    `toolBox.enabled=${config.toolBox.enabled}`,
    `toolBox.borderStyle=${config.toolBox.borderStyle}`,
    `toolBox.accentStripe=${config.toolBox.accentStripe}`,
    `toolBox.verbPack=${config.toolBox.verbPack}`,
    `toolBox.outcomeBadges=${config.toolBox.outcomeBadges}`,
    `toolBox.reuseSpinner=${config.toolBox.reuseSpinner}`,
  ].join(" · ");
}

export async function showTuiSettings(
  ctx: ExtensionContext,
  agentDir: string,
  onChange?: (next: TuiConfig) => void,
): Promise<void> {
  if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
    return;
  }

  await withPromptLock(() =>
    ctx.ui.custom<void>(
      (tui, theme, _keybindings, done) => {
        let current = getActiveTuiConfig();
        const close = (): void => {
          done();
          tui.requestRender(true);
        };
        const buildList = () =>
          new SettingsList(
            buildSettingItems(current),
            12,
            settingsTheme(theme, current.colored),
            (id, value) => {
              const prevColored = current.colored;
              current = applyTuiSetting(current, id, value);
              setActiveTuiConfig(current);
              const res = updateTuiConfig(agentDir, () => current);
              if (!res.ok) {
                ctx.ui?.notify?.(res.error, "error");
              }
              onChange?.(current);
              if (prevColored !== current.colored) {
                list = buildList();
              }
              tui.requestRender(true);
            },
            close,
            { enableSearch: true },
          );
        let list = buildList();

        return {
          render(width: number): string[] {
            const active = getActiveTuiConfig();
            const innerWidth =
              active.borderStyle === "none"
                ? Math.max(1, width)
                : Math.max(1, width - 4);
            const lines = [...list.render(innerWidth)];
            return roundedFrame(lines, width, theme, "TUI settings", {
              borderStyle: active.borderStyle,
              overlaySurface: active.overlaySurface,
              colored: active.colored,
            });
          },
          handleInput(data: string): void {
            list.handleInput(data);
          },
          invalidate(): void {
            list.invalidate();
          },
        };
      },
      {
        overlay: true,
        overlayOptions: {
          width: "70%",
          maxHeight: "75%",
          margin: 1,
        },
      },
    ),
  );
}
