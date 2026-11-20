import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BORDER_STYLES, type BorderStyle } from "@hollowheap/core/border";
import { errorMessage } from "@hollowheap/core/format";
import { isRecord } from "@hollowheap/core/records";
import {
  LOADING_INDICATOR_STYLES,
  type LoadingIndicatorStyle,
  OVERLAY_SURFACE_MODES,
  type OverlaySurfaceMode,
  THINKING_VERBOSITY_MODES,
  TOOL_VERBOSITY_MODES,
  TOOL_VERB_PACKS,
  type ThinkingVerbosityMode,
  type ToolVerbPack,
  type ToolVerbosity,
  type TuiConfig,
  updateTuiConfig,
} from "@hollowheap/core/tui-config";
import { canOverlay, notify } from "@hollowheap/pi-ui/host";
import {
  type SettingsTab,
  showTabbedSettingsDialog,
} from "@hollowheap/pi-ui/settings";
import { getActiveTuiConfig, setActiveTuiConfig } from "@hollowheap/tui/state";
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
      next.panel.borderStyle = next.borderStyle;
      next.panel.style = undefined;
      break;
    case "colored":
      next.colored = value === "true";
      break;
    case "modeIndicator":
      next.modeIndicator = value === "true";
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
    case "panel.borderStyle":
      next.panel.borderStyle = value as BorderStyle;
      next.panel.style = undefined;
      break;
    case "panel.surface":
      next.panel.surface = value as OverlaySurfaceMode;
      next.panel.style = undefined;
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

function buildSettingTabs(config: TuiConfig): SettingsTab[] {
  return [
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
          id: "overlaySurface",
          label: "Overlay surface",
          description: "Background surface fill for TUI overlays",
          currentValue: config.overlaySurface,
          values: [...OVERLAY_SURFACE_MODES],
        },
        {
          id: "colored",
          label: "Colored UI",
          description: "Enable theme foreground, surface, and spinner colors",
          currentValue: String(config.colored),
          values: ["true", "false"],
        },
        {
          id: "modeIndicator",
          label: "Mode indicator",
          description: "Show the active mode in the prompt status row",
          currentValue: String(config.modeIndicator ?? true),
          values: ["true", "false"],
        },
      ],
    },
    {
      label: "Verbosity",
      items: [
        {
          id: "thinkingVerbosity",
          label: "Thinking verbosity",
          description:
            "Host collapsed view, one-line preview, or host expanded view",
          currentValue: config.thinkingVerbosity,
          values: [...THINKING_VERBOSITY_MODES],
        },
        {
          id: "toolVerbosity",
          label: "Tool verbosity",
          description:
            "Arguments only, host collapsed results, or host expanded results",
          currentValue: config.toolVerbosity ?? "medium",
          values: [...TOOL_VERBOSITY_MODES],
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
          id: "verbPack",
          label: "Verb pack",
          description: "Action verb style for tools and thinking",
          currentValue: config.verbPack,
          values: [...TOOL_VERB_PACKS],
        },
      ],
    },
    {
      label: "Loading",
      items: [
        {
          id: "loadingIndicator",
          label: "Loading indicator",
          description: "Working spinner preset for status and panels",
          currentValue: config.loadingIndicator,
          values: [...LOADING_INDICATOR_STYLES],
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
      label: "Panel",
      items: [
        {
          id: "panel.enabled",
          label: "Enable panel customization",
          description: "Wrap tool calls in a configurable self-rendered panel",
          currentValue: String(config.panel.enabled),
          values: ["false", "true"],
        },
        ...(config.panel.enabled
          ? [
              {
                id: "panel.borderStyle",
                label: "Panel border style",
                description: "Border style used when rendering framed panels",
                currentValue: config.panel.borderStyle,
                values: [...BORDER_STYLES],
              },
              {
                id: "panel.surface",
                label: "Panel surface",
                description: "Background surface fill for panels",
                currentValue: config.panel.surface ?? config.overlaySurface,
                values: [...OVERLAY_SURFACE_MODES],
              },
            ]
          : []),
        {
          id: "panel.accentStripe",
          label: "Panel accent stripe",
          description: "Show left state stripe on panels",
          currentValue: String(config.panel.accentStripe),
          values: ["true", "false"],
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
}

export function formatTuiStatus(config: TuiConfig): string {
  return [
    `borderStyle=${config.borderStyle}`,
    `colored=${config.colored}`,
    `modeIndicator=${config.modeIndicator ?? true}`,
    `overlaySurface=${config.overlaySurface}`,
    `loadingIndicator=${config.loadingIndicator}`,
    `markdownRender=${config.markdownRender}`,
    `thinkingVerbosity=${config.thinkingVerbosity}`,
    `thinkingAnimate=${config.thinkingAnimate}`,
    `toolVerbosity=${config.toolVerbosity ?? "medium"}`,
    `verbPack=${config.verbPack}`,
    `panel.enabled=${config.panel.enabled}`,
    `panel.borderStyle=${config.panel.borderStyle}`,
    `panel.surface=${config.panel.surface ?? config.overlaySurface}`,
    `panel.accentStripe=${config.panel.accentStripe}`,
    `panel.outcomeBadges=${config.panel.outcomeBadges}`,
    `panel.reuseSpinner=${config.panel.reuseSpinner}`,
  ].join(" · ");
}

export function cycleTuiVerbosity(
  kind: "toolVerbosity" | "thinkingVerbosity",
  ctx: ExtensionContext,
  agentDir: string,
  onChange?: (next: TuiConfig) => void,
): string {
  const current = getActiveTuiConfig();
  const values: readonly string[] =
    kind === "toolVerbosity" ? TOOL_VERBOSITY_MODES : THINKING_VERBOSITY_MODES;
  const currentValue =
    kind === "toolVerbosity"
      ? (current.toolVerbosity ?? "medium")
      : current.thinkingVerbosity;
  const idx = values.indexOf(currentValue);
  const nextValue = values[(idx + 1) % values.length] ?? values[0] ?? "medium";
  const next = applyTuiSetting(current, kind, nextValue);
  setActiveTuiConfig(next);
  const res = updateTuiConfig(agentDir, () => next);
  if (!res.ok) notify(ctx, res.error, "error");
  onChange?.(next);
  if (ctx.hasUI) {
    const label =
      kind === "toolVerbosity" ? "Tool verbosity" : "Thinking verbosity";
    notify(ctx, `${label}: ${nextValue}`, "info");
  }
  return nextValue;
}

export async function showTuiSettings(
  ctx: ExtensionContext,
  agentDir: string,
  onChange?: (next: TuiConfig) => void,
): Promise<void> {
  if (!canOverlay(ctx)) {
    return;
  }

  await showTabbedSettingsDialog({
    ctx,
    title: "TUI settings",
    tabs: () => buildSettingTabs(getActiveTuiConfig()),
    listHeight: 6,
    promptLock: true,
    colored: () => getActiveTuiConfig().colored,
    frameOptions: () => getActiveTuiConfig(),
    onChange: (id, value, _list, tui) => {
      const next = applyTuiSetting(getActiveTuiConfig(), id, value);
      setActiveTuiConfig(next);
      const res = updateTuiConfig(agentDir, () => next);
      if (!res.ok) notify(ctx, res.error, "error");
      onChange?.(next);
      if (
        id === "toolVerbosity" ||
        id === "thinkingVerbosity" ||
        id === "panel.enabled" ||
        id === "panel.borderStyle" ||
        id === "panel.surface"
      ) {
        tui.invalidate();
      }
    },
  });
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
  const result: Record<string, string | null> = Object.create(null);
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
