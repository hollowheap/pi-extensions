import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BORDER_STYLES, type BorderStyle } from "./border.js";
import {
  type UpdateJsonConfigResult,
  formatFsPermissionError,
  isPermissionError,
  updateJsonConfig,
} from "./config.js";

export type OverlaySurfaceMode =
  | "transparent"
  | "surface"
  | "card"
  | "contrast";

export const OVERLAY_SURFACE_MODES: readonly OverlaySurfaceMode[] = [
  "transparent",
  "surface",
  "card",
  "contrast",
];

export type ToolVerbPack = "standard" | "terse" | "playful";

export const TOOL_VERB_PACKS: readonly ToolVerbPack[] = [
  "standard",
  "terse",
  "playful",
];

export type LoadingIndicatorStyle =
  | "crush"
  | "braille"
  | "pulse"
  | "arc"
  | "bars"
  | "dots"
  | "host"
  | "hidden";

export const LOADING_INDICATOR_STYLES: readonly LoadingIndicatorStyle[] = [
  "crush",
  "braille",
  "pulse",
  "arc",
  "bars",
  "dots",
  "host",
  "hidden",
];

export type ThinkingDisplayMode = "default" | "one-line";

export const THINKING_DISPLAY_MODES: readonly ThinkingDisplayMode[] = [
  "default",
  "one-line",
];

export interface CustomToolVerb {
  active: string;
  settled: string;
}

export interface ToolBoxConfig {
  enabled: boolean;
  borderStyle: BorderStyle;
  accentStripe: boolean;
  verbPack: ToolVerbPack;
  outcomeBadges: boolean;
  reuseSpinner: boolean;
  customVerbs: Record<string, CustomToolVerb>;
}

export interface TuiConfig {
  borderStyle: BorderStyle;
  overlaySurface: OverlaySurfaceMode;
  colored: boolean;
  loadingIndicator: LoadingIndicatorStyle;
  markdownRender: boolean;
  thinkingDisplay: ThinkingDisplayMode;
  thinkingAnimate: boolean;
  toolBox: ToolBoxConfig;
}

export const DEFAULT_TUI_CONFIG: TuiConfig = {
  borderStyle: "rounded",
  overlaySurface: "transparent",
  colored: true,
  loadingIndicator: "crush",
  markdownRender: true,
  thinkingDisplay: "default",
  thinkingAnimate: true,
  toolBox: {
    enabled: false,
    borderStyle: "rounded",
    accentStripe: true,
    verbPack: "standard",
    outcomeBadges: true,
    reuseSpinner: true,
    customVerbs: {},
  },
};

function cloneDefaults(): TuiConfig {
  return {
    ...DEFAULT_TUI_CONFIG,
    toolBox: {
      ...DEFAULT_TUI_CONFIG.toolBox,
      customVerbs: {},
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  if (!isPlainObject(raw)) {
    diagnostics?.push("tui.json: toolBox.customVerbs must be an object");
    return {};
  }
  const result: Record<string, CustomToolVerb> = {};
  for (const [toolName, entry] of Object.entries(raw)) {
    if (!isPlainObject(entry)) {
      diagnostics?.push(
        `tui.json: toolBox.customVerbs.${toolName} must be an object`,
      );
      continue;
    }
    const active = typeof entry.active === "string" ? entry.active.trim() : "";
    const settled =
      typeof entry.settled === "string" ? entry.settled.trim() : "";
    if (!active || !settled) {
      diagnostics?.push(
        `tui.json: toolBox.customVerbs.${toolName} requires non-empty 'active' and 'settled' strings`,
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
  if (!isPlainObject(raw)) {
    if (raw !== undefined) {
      diagnostics?.push("tui.json must be a JSON object");
    }
    return defaults;
  }

  const borderStyle = parseEnum(
    raw.borderStyle,
    BORDER_STYLES,
    defaults.borderStyle,
    "borderStyle",
    diagnostics,
  );
  const overlaySurface = parseEnum(
    raw.overlaySurface,
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
  const markdownRender = parseBoolean(
    raw.markdownRender,
    defaults.markdownRender,
    "markdownRender",
    diagnostics,
  );
  const thinkingDisplay = parseEnum(
    raw.thinkingDisplay,
    THINKING_DISPLAY_MODES,
    defaults.thinkingDisplay,
    "thinkingDisplay",
    diagnostics,
  );
  const thinkingAnimate = parseBoolean(
    raw.thinkingAnimate,
    defaults.thinkingAnimate,
    "thinkingAnimate",
    diagnostics,
  );

  const rawToolBox = raw.toolBox;
  const toolBox: ToolBoxConfig = {
    ...defaults.toolBox,
    borderStyle,
    customVerbs: {},
  };
  if (rawToolBox !== undefined) {
    if (!isPlainObject(rawToolBox)) {
      diagnostics?.push("tui.json: toolBox must be an object");
    } else {
      toolBox.enabled = parseBoolean(
        rawToolBox.enabled,
        defaults.toolBox.enabled,
        "toolBox.enabled",
        diagnostics,
      );

      toolBox.borderStyle = parseEnum(
        rawToolBox.borderStyle,
        BORDER_STYLES,
        borderStyle,
        "toolBox.borderStyle",
        diagnostics,
      );

      toolBox.accentStripe = parseBoolean(
        rawToolBox.accentStripe,
        defaults.toolBox.accentStripe,
        "toolBox.accentStripe",
        diagnostics,
      );

      toolBox.verbPack = parseEnum(
        rawToolBox.verbPack,
        TOOL_VERB_PACKS,
        defaults.toolBox.verbPack,
        "toolBox.verbPack",
        diagnostics,
      );

      toolBox.outcomeBadges = parseBoolean(
        rawToolBox.outcomeBadges,
        defaults.toolBox.outcomeBadges,
        "toolBox.outcomeBadges",
        diagnostics,
      );

      toolBox.reuseSpinner = parseBoolean(
        rawToolBox.reuseSpinner,
        defaults.toolBox.reuseSpinner,
        "toolBox.reuseSpinner",
        diagnostics,
      );

      toolBox.customVerbs = parseCustomVerbs(
        rawToolBox.customVerbs,
        diagnostics,
      );
    }
  } else {
    toolBox.borderStyle = borderStyle;
  }

  return {
    borderStyle,
    overlaySurface,
    colored,
    loadingIndicator,
    markdownRender,
    thinkingDisplay,
    thinkingAnimate,
    toolBox,
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
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
      const message = isPermissionError(error)
        ? formatFsPermissionError("read TUI config", path, error)
        : `cannot read TUI config ${path}: ${
            error instanceof Error ? error.message : String(error)
          }`;
      onDiagnostic?.(message);
    }
    return cloneDefaults();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    onDiagnostic?.(
      `tui.json is not valid JSON (${path}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return cloneDefaults();
  }

  const diagnostics: string[] = [];
  const config = normalizeTuiConfig(parsed, diagnostics);
  for (const diagnostic of diagnostics) {
    onDiagnostic?.(diagnostic);
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
      markdownRender: updated.markdownRender,
      thinkingDisplay: updated.thinkingDisplay,
      thinkingAnimate: updated.thinkingAnimate,
      toolBox: {
        enabled: updated.toolBox.enabled,
        borderStyle: updated.toolBox.borderStyle,
        accentStripe: updated.toolBox.accentStripe,
        verbPack: updated.toolBox.verbPack,
        outcomeBadges: updated.toolBox.outcomeBadges,
        reuseSpinner: updated.toolBox.reuseSpinner,
        customVerbs: { ...updated.toolBox.customVerbs },
      },
    };
  });
}
