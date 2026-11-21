import { join } from "node:path";
import { BORDER_STYLES, type BorderStyle } from "./border.js";
import {
  type UpdateJsonConfigResult,
  readJsonObject,
  updateJsonConfig,
} from "./config.js";
import { isRecord } from "./records.js";

export type OverlaySurfaceMode = "transparent" | "surface" | "card";

export const OVERLAY_SURFACE_MODES: readonly OverlaySurfaceMode[] = [
  "transparent",
  "surface",
  "card",
];

export type PanelRenderMode = "box" | "background";

export const PANEL_RENDER_MODES: readonly PanelRenderMode[] = [
  "box",
  "background",
];

export type PanelStyle =
  | BorderStyle
  | Exclude<OverlaySurfaceMode, "transparent">
  | "background";

export const PANEL_STYLES: readonly PanelStyle[] = [
  ...BORDER_STYLES,
  "surface",
  "card",
  "background",
];

export type ToolVerbPack = "standard" | "terse" | "playful";

export const TOOL_VERB_PACKS: readonly ToolVerbPack[] = [
  "standard",
  "terse",
  "playful",
];

export type LoadingIndicatorStyle =
  | "crush"
  | "claude"
  | "braille"
  | "pulse"
  | "arc"
  | "bars"
  | "dots"
  | "host"
  | "hidden";

export const LOADING_INDICATOR_STYLES: readonly LoadingIndicatorStyle[] = [
  "crush",
  "claude",
  "braille",
  "pulse",
  "arc",
  "bars",
  "dots",
  "host",
  "hidden",
];

export type LoadingIndicatorColor =
  | "gradient"
  | "accent"
  | "borderAccent"
  | "thinkingText"
  | "success"
  | "warning"
  | "error"
  | "text"
  | "muted";

export const LOADING_INDICATOR_COLORS: readonly LoadingIndicatorColor[] = [
  "gradient",
  "accent",
  "borderAccent",
  "thinkingText",
  "success",
  "warning",
  "error",
  "text",
  "muted",
];

export type ShimmerSpeed = "slow" | "normal" | "fast";

export const SHIMMER_SPEEDS: readonly ShimmerSpeed[] = [
  "slow",
  "normal",
  "fast",
];

export type ThinkingVerbosityMode =
  | "verbose"
  | "minimal"
  | "none"
  | "low"
  | "medium"
  | "high";

export const THINKING_VERBOSITY_MODES: readonly ThinkingVerbosityMode[] = [
  "low",
  "medium",
  "high",
];

const THINKING_VERBOSITY_PARSE_MODES: readonly ThinkingVerbosityMode[] = [
  "verbose",
  "minimal",
  "none",
  ...THINKING_VERBOSITY_MODES,
];

export type ToolVerbosity = "low" | "medium" | "high";

export const TOOL_VERBOSITY_MODES: readonly ToolVerbosity[] = [
  "low",
  "medium",
  "high",
];

export interface CustomToolVerb {
  active: string;
  settled: string;
}

export interface PanelConfig {
  enabled: boolean;
  style?: PanelStyle;
  mode: PanelRenderMode;
  borderStyle: BorderStyle;
  accentStripe: boolean;
  outcomeBadges: boolean;
  reuseSpinner: boolean;
  customVerbs: Record<string, CustomToolVerb>;
  surface?: OverlaySurfaceMode;
}

export function getPanelStyle(panel: PanelConfig): PanelStyle {
  if (panel.style !== undefined) return panel.style;
  if (panel.mode === "background") return "background";
  return panel.surface && panel.surface !== "transparent"
    ? panel.surface
    : panel.borderStyle;
}

export function applyPanelStyle(
  panel: PanelConfig,
  style: PanelStyle,
  borderStyle?: BorderStyle,
): PanelConfig {
  if (style === "background") {
    return {
      ...panel,
      style,
      mode: "background",
      borderStyle: "none",
      surface: undefined,
    };
  }
  if (style === "surface" || style === "card") {
    const fallbackBorder =
      borderStyle ??
      (panel.borderStyle !== "none" ? panel.borderStyle : "rounded");
    return {
      ...panel,
      style,
      mode: "box",
      borderStyle: fallbackBorder,
      surface: style,
    };
  }
  return {
    ...panel,
    style,
    mode: "box",
    borderStyle: style,
    surface: "transparent",
  };
}

export interface TuiConfig {
  promptChar: string;
  borderStyle: BorderStyle;
  overlaySurface: OverlaySurfaceMode;
  colored: boolean;
  loadingIndicator: LoadingIndicatorStyle;
  loadingIndicatorColor: LoadingIndicatorColor;
  loadingIndicatorFade: boolean;
  markdownRender: boolean;
  thinkingVerbosity: ThinkingVerbosityMode;
  toolVerbosity?: ToolVerbosity;
  modeIndicator?: boolean;
  thinkingAnimate: boolean;
  shimmerSpeed: ShimmerSpeed;
  verbPack: ToolVerbPack;
  panel: PanelConfig;
}

export const DEFAULT_TUI_CONFIG: TuiConfig = {
  promptChar: "❯",
  borderStyle: "rounded",
  overlaySurface: "transparent",
  colored: true,
  loadingIndicator: "crush",
  loadingIndicatorColor: "gradient",
  loadingIndicatorFade: true,
  markdownRender: true,
  thinkingVerbosity: "verbose",
  toolVerbosity: "medium",
  modeIndicator: true,
  thinkingAnimate: true,
  shimmerSpeed: "normal",
  verbPack: "standard",
  panel: {
    enabled: true,
    mode: "box",
    borderStyle: "rounded",
    surface: "transparent",
    accentStripe: true,
    outcomeBadges: true,
    reuseSpinner: true,
    customVerbs: {},
  },
};

function cloneDefaults(): TuiConfig {
  return {
    ...DEFAULT_TUI_CONFIG,
    panel: {
      ...DEFAULT_TUI_CONFIG.panel,
      customVerbs: {},
    },
  };
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  field: string,
  diagnostics?: string[],
): T {
  if (value === undefined) return fallback;
  if (
    typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
  ) {
    return value as T;
  }
  diagnostics?.push(
    `tui.json: invalid ${field} '${String(value)}', using '${fallback}'`,
  );
  return fallback;
}

function parseCustomVerbs(
  raw: unknown,
  diagnostics?: string[],
): Record<string, CustomToolVerb> {
  if (raw === undefined) return {};
  if (!isRecord(raw)) {
    diagnostics?.push("tui.json: panel.customVerbs must be an object");
    return {};
  }
  const result: Record<string, CustomToolVerb> = {};
  for (const [toolName, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) {
      diagnostics?.push(
        `tui.json: panel.customVerbs.${toolName} must be an object`,
      );
      continue;
    }
    const active = typeof entry.active === "string" ? entry.active.trim() : "";
    const settled =
      typeof entry.settled === "string" ? entry.settled.trim() : "";
    if (!active || !settled) {
      diagnostics?.push(
        `tui.json: panel.customVerbs.${toolName} requires non-empty 'active' and 'settled' strings`,
      );
      continue;
    }
    result[toolName] = { active, settled };
  }
  return result;
}

function parseBoolean(
  value: unknown,
  fallback: boolean,
  field: string,
  diagnostics?: string[],
): boolean {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  diagnostics?.push(`tui.json: ${field} must be a boolean`);
  return fallback;
}

export function normalizeTuiConfig(
  raw: unknown,
  diagnostics?: string[],
): TuiConfig {
  const defaults = cloneDefaults();
  if (!isRecord(raw)) {
    if (raw !== undefined) {
      diagnostics?.push("tui.json must be a JSON object");
    }
    return defaults;
  }

  let borderStyle = parseEnum(
    raw.borderStyle,
    BORDER_STYLES,
    defaults.borderStyle,
    "borderStyle",
    diagnostics,
  );
  const overlaySurface = parseEnum(
    raw.overlaySurface === "contrast" ? "surface" : raw.overlaySurface,
    OVERLAY_SURFACE_MODES,
    defaults.overlaySurface,
    "overlaySurface",
    diagnostics,
  );
  const colored = parseBoolean(
    raw.colored,
    defaults.colored,
    "colored",
    diagnostics,
  );
  const loadingIndicator = parseEnum(
    raw.loadingIndicator,
    LOADING_INDICATOR_STYLES,
    defaults.loadingIndicator,
    "loadingIndicator",
    diagnostics,
  );
  const loadingIndicatorColor = parseEnum(
    raw.loadingIndicatorColor,
    LOADING_INDICATOR_COLORS,
    defaults.loadingIndicatorColor,
    "loadingIndicatorColor",
    diagnostics,
  );
  const loadingIndicatorFade = parseBoolean(
    raw.loadingIndicatorFade,
    defaults.loadingIndicatorFade,
    "loadingIndicatorFade",
    diagnostics,
  );
  const markdownRender = parseBoolean(
    raw.markdownRender,
    defaults.markdownRender,
    "markdownRender",
    diagnostics,
  );
  const legacyThinkingVerbosity =
    raw.thinkingDisplay === "one-line"
      ? "minimal"
      : raw.thinkingDisplay === "default"
        ? "verbose"
        : undefined;
  const thinkingVerbosity = parseEnum(
    raw.thinkingVerbosity ?? legacyThinkingVerbosity,
    THINKING_VERBOSITY_PARSE_MODES,
    defaults.thinkingVerbosity,
    "thinkingVerbosity",
    diagnostics,
  );
  const toolVerbosity = parseEnum(
    raw.toolVerbosity,
    TOOL_VERBOSITY_MODES,
    defaults.toolVerbosity ?? "medium",
    "toolVerbosity",
    diagnostics,
  );
  const modeIndicator = parseBoolean(
    raw.modeIndicator,
    defaults.modeIndicator ?? true,
    "modeIndicator",
    diagnostics,
  );
  const thinkingAnimate = parseBoolean(
    raw.thinkingAnimate,
    defaults.thinkingAnimate,
    "thinkingAnimate",
    diagnostics,
  );
  const shimmerSpeed = parseEnum(
    raw.shimmerSpeed,
    SHIMMER_SPEEDS,
    defaults.shimmerSpeed,
    "shimmerSpeed",
    diagnostics,
  );

  const rawPanel = raw.panel;
  const legacyVerbPack = isRecord(rawPanel) ? rawPanel.verbPack : undefined;
  const verbPack = parseEnum(
    raw.verbPack ?? legacyVerbPack,
    TOOL_VERB_PACKS,
    defaults.verbPack,
    "verbPack",
    diagnostics,
  );
  let panel: PanelConfig = {
    ...defaults.panel,
    borderStyle,
    customVerbs: {},
  };
  if (rawPanel !== undefined) {
    if (!isRecord(rawPanel)) {
      diagnostics?.push("tui.json: panel must be an object");
    } else {
      panel.enabled = parseBoolean(
        rawPanel.enabled,
        DEFAULT_TUI_CONFIG.panel.enabled,
        "panel.enabled",
        diagnostics,
      );

      panel.mode = parseEnum(
        rawPanel.mode,
        PANEL_RENDER_MODES,
        DEFAULT_TUI_CONFIG.panel.mode,
        "panel.mode",
        diagnostics,
      );

      panel.borderStyle = parseEnum(
        rawPanel.borderStyle,
        BORDER_STYLES,
        borderStyle,
        "panel.borderStyle",
        diagnostics,
      );

      panel.surface = parseEnum(
        rawPanel.surface === "contrast" ? "surface" : rawPanel.surface,
        OVERLAY_SURFACE_MODES,
        DEFAULT_TUI_CONFIG.overlaySurface,
        "panel.surface",
        diagnostics,
      );

      panel.accentStripe = parseBoolean(
        rawPanel.accentStripe,
        DEFAULT_TUI_CONFIG.panel.accentStripe,
        "panel.accentStripe",
        diagnostics,
      );

      panel.outcomeBadges = parseBoolean(
        rawPanel.outcomeBadges,
        DEFAULT_TUI_CONFIG.panel.outcomeBadges,
        "panel.outcomeBadges",
        diagnostics,
      );

      panel.reuseSpinner = parseBoolean(
        rawPanel.reuseSpinner,
        DEFAULT_TUI_CONFIG.panel.reuseSpinner,
        "panel.reuseSpinner",
        diagnostics,
      );

      panel.customVerbs = parseCustomVerbs(rawPanel.customVerbs, diagnostics);
      if (rawPanel.style !== undefined) {
        const style = parseEnum(
          rawPanel.style === "contrast" ? "surface" : rawPanel.style,
          PANEL_STYLES,
          getPanelStyle(panel),
          "panel.style",
          diagnostics,
        );
        panel = applyPanelStyle(panel, style, borderStyle);
      }
      if (raw.borderStyle === undefined && rawPanel.borderStyle !== undefined) {
        borderStyle = panel.borderStyle;
      } else if (
        raw.borderStyle === undefined &&
        rawPanel.style !== undefined &&
        (BORDER_STYLES as readonly string[]).includes(String(panel.style))
      ) {
        borderStyle = panel.borderStyle;
      }
    }
  } else {
    panel.borderStyle = borderStyle;
  }

  const promptChar =
    typeof raw.promptChar === "string" && [...raw.promptChar].length === 1
      ? raw.promptChar
      : defaults.promptChar;
  if (raw.promptChar !== undefined && raw.promptChar !== promptChar) {
    diagnostics?.push("tui.json: promptChar must be one character; using ❯");
  }

  return {
    promptChar,
    borderStyle,
    overlaySurface,
    colored,
    loadingIndicator,
    loadingIndicatorColor,
    loadingIndicatorFade,
    markdownRender,
    thinkingVerbosity,
    toolVerbosity,
    modeIndicator,
    thinkingAnimate,
    shimmerSpeed,
    verbPack,
    panel,
  };
}

export function getTuiConfigPath(agentDir: string): string {
  return join(agentDir, "tui.json");
}

export function loadTuiConfig(
  agentDir: string,
  onDiagnostic?: (message: string) => void,
): TuiConfig {
  const path = getTuiConfigPath(agentDir);
  const diagnostics: string[] = [];
  const parsed = readJsonObject(path, diagnostics);
  const config =
    parsed === undefined
      ? cloneDefaults()
      : normalizeTuiConfig(parsed, diagnostics);
  for (const message of diagnostics) {
    onDiagnostic?.(message);
  }
  return config;
}

export function updateTuiConfig(
  agentDir: string,
  mutate: ((current: TuiConfig) => TuiConfig) | ((current: TuiConfig) => void),
): UpdateJsonConfigResult {
  return updateJsonConfig(getTuiConfigPath(agentDir), (current) => {
    const normalized = normalizeTuiConfig(current);
    const updated = mutate(normalized) ?? normalized;
    return {
      ...current,
      borderStyle: updated.borderStyle,
      overlaySurface: updated.overlaySurface,
      colored: updated.colored,
      loadingIndicator: updated.loadingIndicator,
      loadingIndicatorColor: updated.loadingIndicatorColor,
      loadingIndicatorFade: updated.loadingIndicatorFade,
      markdownRender: updated.markdownRender,
      thinkingVerbosity: updated.thinkingVerbosity,
      toolVerbosity: updated.toolVerbosity,
      modeIndicator: updated.modeIndicator,
      thinkingAnimate: updated.thinkingAnimate,
      shimmerSpeed: updated.shimmerSpeed,
      verbPack: updated.verbPack,
      panel: {
        enabled: updated.panel?.enabled ?? DEFAULT_TUI_CONFIG.panel.enabled,
        ...(updated.panel.style === undefined
          ? {
              mode: updated.panel.mode,
              borderStyle: updated.panel.borderStyle,
              surface:
                updated.panel.surface ?? DEFAULT_TUI_CONFIG.overlaySurface,
            }
          : { style: updated.panel.style }),
        accentStripe:
          updated.panel?.accentStripe ?? DEFAULT_TUI_CONFIG.panel.accentStripe,
        outcomeBadges:
          updated.panel?.outcomeBadges ??
          DEFAULT_TUI_CONFIG.panel.outcomeBadges,
        reuseSpinner:
          updated.panel?.reuseSpinner ?? DEFAULT_TUI_CONFIG.panel.reuseSpinner,
        customVerbs: { ...(updated.panel?.customVerbs ?? {}) },
      },
    };
  });
}
