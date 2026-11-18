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
  PANEL_RENDER_MODES,
  THINKING_VERBOSITY_MODES,
  TOOL_VERB_PACKS,
  type ThinkingVerbosityMode,
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
    panel: {
      ...(current.panel ?? {}),
      customVerbs: { ...(current.panel?.customVerbs ?? {}) },
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
    case "thinkingVerbosity":
      next.thinkingVerbosity = value as ThinkingVerbosityMode;
      break;
    case "thinkingAnimate":
      next.thinkingAnimate = value === "true";
      break;
    case "panel.enabled":
      next.panel.enabled = value === "true";
      break;
    case "panel.mode":
      next.panel.mode = value as TuiConfig["panel"]["mode"];
      break;
    case "panel.borderStyle":
      next.panel.borderStyle = value as BorderStyle;
      break;
    case "panel.accentStripe":
      next.panel.accentStripe = value === "true";
      break;
    case "verbPack":
      next.verbPack = value as ToolVerbPack;
      break;
    case "panel.outcomeBadges":
      next.panel.outcomeBadges = value === "true";
      break;
    case "panel.reuseSpinner":
      next.panel.reuseSpinner = value === "true";
      break;
  }
  return next;
}

export interface ContributedTuiSetting extends SettingItem {
  owner?: string;
  onChange?: (value: string) => void;
}

function buildSettingItems(
  config: TuiConfig,
  contributed: readonly ContributedTuiSetting[] = [],
): SettingItem[] {
  return [
    ...contributed.map((item) => ({
      id: item.id,
      label: item.label,
      description: item.description,
      currentValue: item.currentValue,
      values: item.values,
    })),
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
      description: "Working spinner preset for status and panels",
      currentValue: config.loadingIndicator,
      values: [...LOADING_INDICATOR_STYLES],
    },
    {
      id: "markdownRender",
      label: "Whole markdown",
      description:
        "Render full Markdown, including normalized horizontal rules",
      currentValue: String(config.markdownRender),
      values: ["true", "false"],
    },
    {
      id: "thinkingVerbosity",
      label: "Thinking verbosity",
      description: "Full, single-line, or no thinking output",
      currentValue: config.thinkingVerbosity,
      values: [...THINKING_VERBOSITY_MODES],
    },
    {
      id: "thinkingAnimate",
      label: "Thinking shimmer",
      description: "Animate scrolling color sweep across one-line thinking",
      currentValue: String(config.thinkingAnimate),
      values: ["true", "false"],
    },
    {
      id: "panel.enabled",
      label: "Panel renderer",
      description: "Wrap tool calls in a configurable self-rendered panel",
      currentValue: String(config.panel.enabled),
      values: ["false", "true"],
    },
    {
      id: "panel.mode",
      label: "Panel style",
      description:
        "Draw a framed box or fill tool calls with a background color",
      currentValue: config.panel.mode,
      values: [...PANEL_RENDER_MODES],
    },
    {
      id: "panel.borderStyle",
      label: "Panel border",
      description: "Border style used by the panel renderer",
      currentValue: config.panel.borderStyle,
      values: [...BORDER_STYLES],
    },
    {
      id: "panel.accentStripe",
      label: "Panel accent stripe",
      description: "Show left state stripe on panels",
      currentValue: String(config.panel.accentStripe),
      values: ["true", "false"],
    },
    {
      id: "verbPack",
      label: "Verb pack",
      description: "Action verb style for tools and thinking",
      currentValue: config.verbPack,
      values: [...TOOL_VERB_PACKS],
    },
    {
      id: "panel.outcomeBadges",
      label: "Panel outcome badges",
      description: "Show ✓/✗ and execution duration badges when settled",
      currentValue: String(config.panel.outcomeBadges),
      values: ["true", "false"],
    },
    {
      id: "panel.reuseSpinner",
      label: "Panel spinner",
      description: "Reuse gradient spinner animation while tools run",
      currentValue: String(config.panel.reuseSpinner),
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
    `thinkingVerbosity=${config.thinkingVerbosity}`,
    `thinkingAnimate=${config.thinkingAnimate}`,
    `verbPack=${config.verbPack}`,
    `panel.enabled=${config.panel.enabled}`,
    `panel.mode=${config.panel.mode}`,
    `panel.borderStyle=${config.panel.borderStyle}`,
    `panel.accentStripe=${config.panel.accentStripe}`,
    `panel.outcomeBadges=${config.panel.outcomeBadges}`,
    `panel.reuseSpinner=${config.panel.reuseSpinner}`,
  ].join(" · ");
}

export async function showTuiSettings(
  ctx: ExtensionContext,
  agentDir: string,
  onChange?: (next: TuiConfig) => void,
  contributed: readonly ContributedTuiSetting[] = [],
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
            buildSettingItems(current, contributed),
            12,
            settingsTheme(theme, current.colored),
            (id, value) => {
              const contributedSetting = contributed.find(
                (item) => item.id === id,
              );
              if (contributedSetting !== undefined) {
                contributedSetting.currentValue = value;
                contributedSetting.onChange?.(value);
                tui.requestRender(true);
                return;
              }
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
