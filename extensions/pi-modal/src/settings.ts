import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type SettingItem, SettingsList } from "@earendil-works/pi-tui";
import { errorMessage } from "@hollowheap/core/format";
import { isRecord } from "@hollowheap/core/records";
import { settingsListTheme } from "@hollowheap/pi-ui/settings";

import { BORDER_STYLES, type BorderStyle } from "@hollowheap/core/border";
import { withPromptLock } from "@hollowheap/core/prompt-lock";
import {
  LOADING_INDICATOR_STYLES,
  type LoadingIndicatorStyle,
  OVERLAY_SURFACE_MODES,
  type OverlaySurfaceMode,
  PANEL_STYLES,
  type PanelStyle,
  THINKING_VERBOSITY_MODES,
  TOOL_VERBOSITY_MODES,
  TOOL_VERB_PACKS,
  type ThinkingVerbosityMode,
  type ToolVerbPack,
  type ToolVerbosity,
  type TuiConfig,
  applyPanelStyle,
  getPanelStyle,
  updateTuiConfig,
} from "@hollowheap/core/tui-config";
import { canOverlay, notify, showDialog } from "@hollowheap/pi-ui/host";
import { boxFrame, getFrameInnerWidth } from "@hollowheap/tui/frame";
import { getActiveTuiConfig, setActiveTuiConfig } from "@hollowheap/tui/state";
import { TabbedContent } from "@hollowheap/tui/tabs";
import type { EditorMode, ModalConfig } from "./keymap.js";

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
      if (next.panel.style !== undefined) {
        next.panel = applyPanelStyle(
          next.panel,
          next.panel.style,
          next.borderStyle,
        );
      }
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
    case "toolVerbosity":
      next.toolVerbosity = value as ToolVerbosity;
      break;
    case "panel.enabled":
      next.panel.enabled = value === "true";
      break;
    case "panel.style":
      next.panel = applyPanelStyle(
        next.panel,
        value as PanelStyle,
        next.borderStyle,
      );
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

function buildSettingTabs(
  config: TuiConfig,
  contributed: readonly ContributedTuiSetting[],
): { label: string; items: SettingItem[] }[] {
  const tabs: { label: string; items: SettingItem[] }[] = [
    {
      label: "Appearance",
      items: [
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
      ],
    },
    {
      label: "Output",
      items: [
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
          description:
            "Host collapsed view, one-line preview, or host expanded view",
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
      ],
    },
    {
      label: "Tools",
      items: [
        {
          id: "toolVerbosity",
          label: "Tool verbosity",
          description:
            "Arguments only, host collapsed results, or host expanded results",
          currentValue: config.toolVerbosity ?? "medium",
          values: [...TOOL_VERBOSITY_MODES],
        },
        {
          id: "panel.enabled",
          label: "Panel renderer",
          description: "Wrap tool calls in a configurable self-rendered panel",
          currentValue: String(config.panel.enabled),
          values: ["false", "true"],
        },
        {
          id: "panel.style",
          label: "Panel style",
          description:
            "Border, themed box, or borderless surface for tool panels",
          currentValue: getPanelStyle(config.panel),
          values: [...PANEL_STYLES],
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
      ],
    },
  ];
  if (contributed.length > 0) {
    tabs.push({
      label: "Extensions",
      items: contributed.map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description,
        currentValue: item.currentValue,
        values: item.values,
      })),
    });
  }
  return tabs;
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
    `toolVerbosity=${config.toolVerbosity ?? "medium"}`,
    `verbPack=${config.verbPack}`,
    `panel.enabled=${config.panel.enabled}`,
    `panel.style=${getPanelStyle(config.panel)}`,
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
  if (!canOverlay(ctx)) {
    return;
  }

  await withPromptLock(() =>
    showDialog<void>(
      ctx,
      (tui, theme, _keybindings, done) => {
        let closed = false;
        const close = (): void => {
          if (closed) return;
          closed = true;
          done();
          tui.requestRender(true);
        };
        const changeSetting = (id: string, value: string): void => {
          const contributedSetting = contributed.find((item) => item.id === id);
          if (contributedSetting !== undefined) {
            contributedSetting.currentValue = value;
            contributedSetting.onChange?.(value);
          } else {
            const next = applyTuiSetting(getActiveTuiConfig(), id, value);
            setActiveTuiConfig(next);
            const res = updateTuiConfig(agentDir, () => next);
            if (!res.ok) notify(ctx, res.error, "error");
            onChange?.(next);
            if (
              id === "toolVerbosity" ||
              id === "thinkingVerbosity" ||
              id === "panel.style"
            )
              tui.invalidate();
          }
          tui.requestRender(true);
        };
        const listTheme = settingsListTheme(
          theme,
          () => getActiveTuiConfig().colored,
        );
        const tabs = new TabbedContent(
          buildSettingTabs(getActiveTuiConfig(), contributed).map(
            ({ label, items }) => ({
              label,
              content: new SettingsList(
                items,
                6,
                listTheme,
                changeSetting,
                close,
                { enableSearch: true },
              ),
            }),
          ),
          (label, active) =>
            getActiveTuiConfig().colored
              ? theme.fg(active ? "accent" : "muted", label)
              : label,
        );

        return {
          render(width: number): string[] {
            const active = getActiveTuiConfig();
            const innerWidth = getFrameInnerWidth(width, active.borderStyle);
            return boxFrame(
              tabs.render(innerWidth),
              width,
              theme,
              "TUI settings",
              active,
            );
          },
          handleInput(data: string): void {
            tabs.handleInput(data);
          },
          invalidate(): void {
            tabs.invalidate();
          },
          dispose: close,
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

const VALID_MODES = new Set<EditorMode>(["normal", "insert", "visual"]);
const VALID_STYLES = new Set<string>(BORDER_STYLES);

function defaults(): ModalConfig {
  return {
    enabled: true,
    initialMode: "insert",
    promptChar: "❯",
    borderStyle: "rounded",
    keymaps: { normal: {}, visual: {}, insert: {} },
  };
}

function keymap(
  value: unknown,
  name: string,
  onDiagnostic?: (message: string) => void,
): Record<string, string | null> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    onDiagnostic?.(`keymaps.${name} must be an object; ignoring`);
    return {};
  }
  const result: Record<string, string | null> = {};
  for (const [key, sequence] of Object.entries(value)) {
    if (key === "" || (typeof sequence !== "string" && sequence !== null)) {
      onDiagnostic?.(
        `keymaps.${name}.${key || "<empty>"} must be a string or null; ignoring`,
      );
      continue;
    }
    result[key] = sequence;
  }
  return result;
}

export function loadModalConfig(
  agentDir: string,
  onDiagnostic?: (message: string) => void,
): ModalConfig {
  const configPath = join(agentDir, "modal.json");
  if (!existsSync(configPath)) return defaults();

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (error) {
    onDiagnostic?.(`cannot read modal.json: ${errorMessage(error)}`);
    return defaults();
  }
  if (!isRecord(parsed)) {
    onDiagnostic?.("modal.json must be an object; using defaults");
    return defaults();
  }

  const config = defaults();
  if (parsed.enabled !== undefined) {
    if (typeof parsed.enabled === "boolean") config.enabled = parsed.enabled;
    else onDiagnostic?.("enabled must be a boolean; using true");
  }

  if (parsed.initialMode !== undefined) {
    if (
      typeof parsed.initialMode === "string" &&
      VALID_MODES.has(parsed.initialMode as EditorMode)
    ) {
      config.initialMode = parsed.initialMode as EditorMode;
    } else {
      onDiagnostic?.(
        'initialMode must be "normal", "insert", or "visual"; using insert',
      );
    }
  }

  if (parsed.promptChar !== undefined) {
    if (
      typeof parsed.promptChar === "string" &&
      [...parsed.promptChar].length === 1
    ) {
      config.promptChar = parsed.promptChar;
    } else {
      onDiagnostic?.("promptChar must be one character; using ❯");
    }
  }

  if (parsed.borderStyle !== undefined) {
    if (
      typeof parsed.borderStyle === "string" &&
      VALID_STYLES.has(parsed.borderStyle)
    ) {
      config.borderStyle = parsed.borderStyle as BorderStyle;
      config.borderStyleExplicit = true;
    } else {
      onDiagnostic?.(
        'borderStyle must be "rounded", "sharp", "square", "double", "dashed", or "none"; using rounded',
      );
    }
  }

  if (parsed.keymaps !== undefined) {
    if (!isRecord(parsed.keymaps)) {
      onDiagnostic?.("keymaps must be an object; ignoring");
    } else {
      config.keymaps = {
        normal: keymap(parsed.keymaps.normal, "normal", onDiagnostic),
        visual: keymap(parsed.keymaps.visual, "visual", onDiagnostic),
        insert: keymap(parsed.keymaps.insert, "insert", onDiagnostic),
      };
    }
  }
  return config;
}
