import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  type SettingItem,
  SettingsList,
  type SettingsListTheme,
} from "@earendil-works/pi-tui";
import { BORDER_STYLES, type BorderStyle } from "@hollowheap/core/border";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import {
  OVERLAY_SURFACE_MODES,
  type OverlaySurfaceMode,
  TOOL_VERB_PACKS,
  type ToolVerbPack,
  type TuiConfig,
  updateTuiConfig,
} from "@hollowheap/core/tui-config";
import { roundedFrame } from "@hollowheap/tui/frame";
import { getActiveTuiConfig, setActiveTuiConfig } from "@hollowheap/tui/state";

function settingsTheme(theme: Theme): SettingsListTheme {
  return {
    label: (text, selected) =>
      selected ? theme.fg("accent", text) : theme.fg("text", text),
    value: (text, selected) =>
      selected ? theme.fg("accent", text) : theme.fg("muted", text),
    description: (text) => theme.fg("muted", text),
    cursor: theme.fg("accent", "› "),
    hint: (text) => theme.fg("dim", text),
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
    case "overlaySurface":
      next.overlaySurface = value as OverlaySurfaceMode;
      break;
    case "shortMode":
      next.shortMode = value === "true";
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
      id: "overlaySurface",
      label: "Overlay surface",
      description: "Background surface fill for TUI overlays",
      currentValue: config.overlaySurface,
      values: [...OVERLAY_SURFACE_MODES],
    },
    {
      id: "shortMode",
      label: "Short mode",
      description: "Compact single-letter mode badges",
      currentValue: String(config.shortMode),
      values: ["false", "true"],
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
    `overlaySurface=${config.overlaySurface}`,
    `shortMode=${config.shortMode}`,
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
        const list = new SettingsList(
          buildSettingItems(current),
          10,
          settingsTheme(theme),
          (id, value) => {
            current = applyTuiSetting(current, id, value);
            setActiveTuiConfig(current);
            const res = updateTuiConfig(agentDir, () => current);
            if (!res.ok) {
              ctx.ui?.notify?.(res.error, "error");
            }
            onChange?.(current);
            tui.requestRender();
          },
          () => done(),
          { enableSearch: true },
        );

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
