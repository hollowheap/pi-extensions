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
  shortMode: boolean;
  toolBox: ToolBoxConfig;
}

export const DEFAULT_TUI_CONFIG: TuiConfig = {
  borderStyle: "rounded",
  overlaySurface: "transparent",
  shortMode: false,
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
    borderStyle: DEFAULT_TUI_CONFIG.borderStyle,
    overlaySurface: DEFAULT_TUI_CONFIG.overlaySurface,
    shortMode: DEFAULT_TUI_CONFIG.shortMode,
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
  const shortMode =
    typeof raw.shortMode === "boolean" ? raw.shortMode : defaults.shortMode;
  if (raw.shortMode !== undefined && typeof raw.shortMode !== "boolean") {
    diagnostics?.push("tui.json: shortMode must be a boolean");
  }

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
      if (typeof rawToolBox.enabled === "boolean") {
        toolBox.enabled = rawToolBox.enabled;
      } else if (rawToolBox.enabled !== undefined) {
        diagnostics?.push("tui.json: toolBox.enabled must be a boolean");
      }

      toolBox.borderStyle = parseEnum(
        rawToolBox.borderStyle,
        BORDER_STYLES,
        borderStyle,
        "toolBox.borderStyle",
        diagnostics,
      );

      if (typeof rawToolBox.accentStripe === "boolean") {
        toolBox.accentStripe = rawToolBox.accentStripe;
      } else if (rawToolBox.accentStripe !== undefined) {
        diagnostics?.push("tui.json: toolBox.accentStripe must be a boolean");
      }

      toolBox.verbPack = parseEnum(
        rawToolBox.verbPack,
        TOOL_VERB_PACKS,
        defaults.toolBox.verbPack,
        "toolBox.verbPack",
        diagnostics,
      );

      if (typeof rawToolBox.outcomeBadges === "boolean") {
        toolBox.outcomeBadges = rawToolBox.outcomeBadges;
      } else if (rawToolBox.outcomeBadges !== undefined) {
        diagnostics?.push("tui.json: toolBox.outcomeBadges must be a boolean");
      }

      if (typeof rawToolBox.reuseSpinner === "boolean") {
        toolBox.reuseSpinner = rawToolBox.reuseSpinner;
      } else if (rawToolBox.reuseSpinner !== undefined) {
        diagnostics?.push("tui.json: toolBox.reuseSpinner must be a boolean");
      }

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
    shortMode,
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
      shortMode: updated.shortMode,
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
