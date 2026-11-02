import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type EditorMode = "normal" | "insert" | "visual";

export interface ModalKeymapConfig {
  normal?: Record<string, string | null>;
  visual?: Record<string, string | null>;
  insert?: Record<string, string | null>;
}

export type BorderStyle = "rounded" | "double" | "dashed" | "sharp" | "none";

export interface ModalConfig {
  enabled?: boolean;
  initialMode?: EditorMode;
  promptChar?: string;
  borderStyle?: BorderStyle;
  keymaps?: ModalKeymapConfig;
}

export const DEFAULT_NORMAL_KEYS: Record<string, string | null> = {
  h: "\x1b[D",
  j: "\x1b[B",
  k: "\x1b[A",
  l: "\x1b[C",
  w: "\x1bf",
  b: "\x1bb",
  "0": "\x01",
  $: "\x05",
  x: "\x1b[3~",
  u: "\x1a",
  i: null,
  a: null,
  I: null,
  A: null,
  o: null,
  v: null,
};

export const DEFAULT_VISUAL_KEYS: Record<string, string | null> = {
  h: "\x1b[D",
  j: "\x1b[B",
  k: "\x1b[A",
  l: "\x1b[C",
  w: "\x1bf",
  b: "\x1bb",
  "0": "\x01",
  $: "\x05",
  v: null,
  y: null,
  d: null,
  x: null,
  c: null,
};

export const DEFAULT_INSERT_KEYS: Record<string, string | null> = {};

const VALID_MODES = new Set<EditorMode>(["normal", "insert", "visual"]);
const VALID_STYLES = new Set<BorderStyle>([
  "rounded",
  "double",
  "dashed",
  "sharp",
  "none",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
    onDiagnostic?.(
      `cannot read modal.json: ${error instanceof Error ? error.message : String(error)}`,
    );
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
      VALID_STYLES.has(parsed.borderStyle as BorderStyle)
    ) {
      config.borderStyle = parsed.borderStyle as BorderStyle;
    } else {
      onDiagnostic?.(
        'borderStyle must be "rounded", "double", "dashed", "sharp", or "none"; using rounded',
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

export function resolveEffectiveKeymaps(userConfig?: ModalConfig): {
  normal: Record<string, string | null>;
  visual: Record<string, string | null>;
  insert: Record<string, string | null>;
} {
  return {
    normal: {
      ...DEFAULT_NORMAL_KEYS,
      ...(userConfig?.keymaps?.normal ?? {}),
    },
    visual: {
      ...DEFAULT_VISUAL_KEYS,
      ...(userConfig?.keymaps?.visual ?? {}),
    },
    insert: {
      ...DEFAULT_INSERT_KEYS,
      ...(userConfig?.keymaps?.insert ?? {}),
    },
  };
}
