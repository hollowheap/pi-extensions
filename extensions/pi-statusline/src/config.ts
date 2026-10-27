import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThemeBg, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Color } from "@earendil-works/pi-tui";
import { parseColorSpec } from "./colors.js";
import { BUILTINS } from "./components.js";

export interface ComponentSpec {
  type: string;
  [option: string]: unknown;
}

export interface StyledComponentSpec extends ComponentSpec {
  fg?: ThemeColor | Color;
  bg?: ThemeBg | Color;
  bold?: boolean;
  accent?: ThemeColor | Color;
  icon?: string;
  iconSide?: "left" | "right";
  iconFg?: ThemeColor | Color;
  iconBg?: ThemeBg | Color;
  leftCap?: string;
  rightCap?: string;
}

export interface ResolvedSeparator {
  text: string;
  fg?: ThemeColor | Color;
  bg?: ThemeBg | Color;
  bold?: boolean;
}

export interface StatuslineOptions {
  componentSeparator: ResolvedSeparator;
  sectionSeparator: ResolvedSeparator;
  gitIntervalMs: number;
}

export interface StatuslineConfig {
  options: StatuslineOptions;
  sections: Record<string, StyledComponentSpec[]>;
  extensions: string[];
}

export const DEFAULT_EXTENSIONS: readonly string[] = ["mode-guard", "budgets"];

export const CONFIG_FILE_NAME = "statusline.json";

export function defaultOptions(): StatuslineOptions {
  return {
    componentSeparator: { text: " " },
    sectionSeparator: { text: "  " },
    gitIntervalMs: 5000,
  };
}

export function defaultConfig(): StatuslineConfig {
  return {
    options: defaultOptions(),
    sections: {
      a: [{ type: "mode-guard" }],
      b: [{ type: "git_branch" }, { type: "cwd" }],
      y: [{ type: "tokens" }, { type: "cost" }, { type: "budgets" }],
      z: [{ type: "model" }, { type: "thinking" }, { type: "clock" }],
    },
    extensions: [...DEFAULT_EXTENSIONS],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FG_TOKENS: readonly ThemeColor[] = [
  "accent",
  "border",
  "borderAccent",
  "borderMuted",
  "success",
  "error",
  "warning",
  "muted",
  "dim",
  "text",
  "thinkingText",
  "scrollbarTrack",
  "scrollbarThumb",
  "searchMatchText",
  "userMessageText",
  "customMessageText",
  "customMessageLabel",
  "toolTitle",
  "toolOutput",
  "mdHeading",
  "mdLink",
  "mdLinkUrl",
  "mdCode",
  "mdCodeBlock",
  "mdCodeBlockBorder",
  "mdQuote",
  "mdQuoteBorder",
  "mdHr",
  "mdListBullet",
  "toolDiffAdded",
  "toolDiffRemoved",
  "toolDiffContext",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXhigh",
  "thinkingMax",
  "bashMode",
];

const BG_TOKENS: readonly ThemeBg[] = [
  "selectedBg",
  "searchMatchBg",
  "userMessageBg",
  "customMessageBg",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
];

function resolveColor<T extends string>(
  value: unknown,
  tokens: readonly T[],
  label: string,
  diagnostics: string[],
): T | Color | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value === "string" &&
    (tokens as readonly string[]).includes(value)
  )
    return value as T;
  if (typeof value === "string" || typeof value === "number") {
    const color = parseColorSpec(value);
    if (color !== undefined) return color;
    diagnostics.push(
      `${label} must be a theme color, starship color, or hex value; ignoring`,
    );
    return undefined;
  }
  diagnostics.push(
    `${label} must be a theme color, starship color, or hex value; ignoring`,
  );
  return undefined;
}

export function normalizeSeparator(
  input: unknown,
  label: string,
  defaultText: string,
  diagnostics: string[],
): ResolvedSeparator {
  if (input === undefined) return { text: defaultText };
  if (typeof input === "string") return { text: input };
  if (!isRecord(input)) {
    diagnostics.push(`${label} must be a string or object; using default`);
    return { text: defaultText };
  }
  const text = typeof input.text === "string" ? input.text : defaultText;
  if (input.text !== undefined && typeof input.text !== "string") {
    diagnostics.push(`${label}.text must be a string; using default`);
  }
  const fg = resolveColor(input.fg, FG_TOKENS, `${label}.fg`, diagnostics);
  const bg = resolveColor(input.bg, BG_TOKENS, `${label}.bg`, diagnostics);
  let bold: boolean | undefined;
  if (input.bold !== undefined) {
    if (typeof input.bold === "boolean") bold = input.bold;
    else diagnostics.push(`${label}.bold must be a boolean; ignoring`);
  }
  return { text, fg, bg, bold };
}

const STYLE_KEYS: ReadonlySet<string> = new Set([
  "type",
  "fg",
  "bg",
  "bold",
  "accent",
  "icon",
  "iconSide",
  "iconFg",
  "iconBg",
  "leftCap",
  "rightCap",
]);

export function normalizeComponentStyle(
  spec: StyledComponentSpec,
  label: string,
  diagnostics: string[],
): StyledComponentSpec {
  const styled: StyledComponentSpec = { type: spec.type };
  for (const [option, value] of Object.entries(spec)) {
    if (!STYLE_KEYS.has(option)) styled[option] = value;
  }
  if (spec.accent !== undefined) {
    const accent = resolveColor(
      spec.accent,
      FG_TOKENS,
      `${label}.accent`,
      diagnostics,
    );
    if (accent !== undefined) styled.accent = accent;
  }
  if (typeof spec.icon === "string") styled.icon = spec.icon;
  if (spec.iconSide === "left" || spec.iconSide === "right") {
    styled.iconSide = spec.iconSide;
  } else if (spec.iconSide !== undefined) {
    diagnostics.push(`${label}.iconSide must be "left" or "right"; ignoring`);
  }
  if (spec.iconFg !== undefined) {
    const iconFg = resolveColor(
      spec.iconFg,
      FG_TOKENS,
      `${label}.iconFg`,
      diagnostics,
    );
    if (iconFg !== undefined) styled.iconFg = iconFg;
  }
  if (spec.iconBg !== undefined) {
    const iconBg = resolveColor(
      spec.iconBg,
      BG_TOKENS,
      `${label}.iconBg`,
      diagnostics,
    );
    if (iconBg !== undefined) styled.iconBg = iconBg;
  }
  if (typeof spec.leftCap === "string") styled.leftCap = spec.leftCap;
  if (typeof spec.rightCap === "string") styled.rightCap = spec.rightCap;
  if (spec.fg !== undefined) {
    const fg = resolveColor(spec.fg, FG_TOKENS, `${label}.fg`, diagnostics);
    if (fg !== undefined) styled.fg = fg;
  }
  if (spec.bg !== undefined) {
    const bg = resolveColor(spec.bg, BG_TOKENS, `${label}.bg`, diagnostics);
    if (bg !== undefined) styled.bg = bg;
  }
  if (typeof spec.bold === "boolean") styled.bold = spec.bold;
  else if (spec.bold !== undefined) {
    diagnostics.push(`${label}.bold must be a boolean; ignoring`);
  }
  return styled;
}

function readSeparatorOption(
  source: Record<string, unknown>,
  key: "componentSeparator" | "sectionSeparator",
  config: StatuslineOptions,
  diagnostics: string[],
): void {
  const value = source[key];
  if (value === undefined) return;
  config[key] = normalizeSeparator(
    value,
    `options.${key}`,
    config[key].text,
    diagnostics,
  );
}

export function normalizeConfig(input: unknown): {
  config: StatuslineConfig;
  diagnostics: string[];
} {
  const diagnostics: string[] = [];
  const config = defaultConfig();
  if (!isRecord(input)) {
    if (input !== undefined)
      diagnostics.push("config root must be an object; using defaults");
    return { config, diagnostics };
  }
  const options = input.options;
  if (options !== undefined) {
    if (!isRecord(options)) {
      diagnostics.push("options must be an object; using defaults");
    } else {
      readSeparatorOption(
        options,
        "componentSeparator",
        config.options,
        diagnostics,
      );
      readSeparatorOption(
        options,
        "sectionSeparator",
        config.options,
        diagnostics,
      );
      const interval = options.gitIntervalMs;
      if (interval !== undefined) {
        if (
          typeof interval === "number" &&
          Number.isFinite(interval) &&
          interval > 0
        ) {
          config.options.gitIntervalMs = interval;
        } else {
          diagnostics.push(
            "options.gitIntervalMs must be a positive number; using default",
          );
        }
      }
    }
  }
  const sections = input.sections;
  if (sections === undefined && input.extensions === undefined) {
    return { config, diagnostics };
  }
  if (input.extensions !== undefined) {
    if (!Array.isArray(input.extensions)) {
      diagnostics.push("extensions must be an array of names; using defaults");
    } else {
      const names: string[] = [];
      for (const entry of input.extensions) {
        if (typeof entry !== "string" || entry === "") {
          diagnostics.push(
            "ignoring extension entry: must be a non-empty string",
          );
        } else {
          names.push(entry);
        }
      }
      config.extensions = names;
    }
  }
  if (sections === undefined) return { config, diagnostics };
  if (!isRecord(sections)) {
    diagnostics.push("sections must be an object; using defaults");
    return { config, diagnostics };
  }
  const normalized: Record<string, StyledComponentSpec[]> = {};
  for (const [key, value] of Object.entries(sections)) {
    if (!/^[a-z]$/.test(key)) {
      diagnostics.push(
        `ignoring sections.${key}: key must be a single letter a-z`,
      );
      continue;
    }
    if (!Array.isArray(value)) {
      diagnostics.push(
        `ignoring sections.${key}: must be an array of components`,
      );
      continue;
    }
    const specs: StyledComponentSpec[] = [];
    for (const [index, item] of value.entries()) {
      if (!isRecord(item) || typeof item.type !== "string") {
        diagnostics.push(
          `ignoring entry in sections.${key}: each component needs a string "type"`,
        );
        continue;
      }
      if (!(item.type in BUILTINS) && !config.extensions.includes(item.type)) {
        diagnostics.push(
          `ignoring unknown component type "${item.type}" in sections.${key}`,
        );
        continue;
      }
      specs.push(
        normalizeComponentStyle(
          { ...item, type: item.type },
          `sections.${key}[${index}]`,
          diagnostics,
        ),
      );
    }
    normalized[key] = specs;
  }
  if (Object.values(normalized).every((specs) => specs.length === 0)) {
    diagnostics.push("sections has no usable components; using defaults");
  } else {
    config.sections = normalized;
  }
  return { config, diagnostics };
}

export function loadConfig(agentDir: string): {
  config: StatuslineConfig;
  diagnostics: string[];
  path: string;
} {
  const path = join(agentDir, CONFIG_FILE_NAME);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { config: defaultConfig(), diagnostics: [], path };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      config: defaultConfig(),
      diagnostics: [`${path} is not valid JSON; using defaults`],
      path,
    };
  }
  const { config, diagnostics } = normalizeConfig(parsed);
  return { config, diagnostics, path };
}
