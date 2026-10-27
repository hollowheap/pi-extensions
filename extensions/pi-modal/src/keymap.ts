import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type EditorMode = "normal" | "insert" | "visual";

export interface ModalKeymapConfig {
  normal?: Record<string, string | null>;
  visual?: Record<string, string | null>;
  insert?: Record<string, string | null>;
}

export interface ModalConfig {
  enabled?: boolean;
  initialMode?: EditorMode;
  keymaps?: ModalKeymapConfig;
}

export const DEFAULT_NORMAL_KEYS: Record<string, string | null> = {
  h: "\x1b[D", // Left
  j: "\x1b[B", // Down
  k: "\x1b[A", // Up
  l: "\x1b[C", // Right
  "0": "\x01", // Start of line
  $: "\x05", // End of line
  x: "\x1b[3~", // Delete char
  u: "\x1a", // Undo
  i: null, // Switch to insert
  a: null, // Append (insert + right)
  I: null, // Insert at line start
  A: null, // Append at line end
  o: null, // Open line below
  v: null, // Switch to visual
};

export const DEFAULT_VISUAL_KEYS: Record<string, string | null> = {
  h: "\x1b[D",
  j: "\x1b[B",
  k: "\x1b[A",
  l: "\x1b[C",
  v: null, // Toggle back to normal
  y: null, // Yank selection
  d: null, // Delete selection
  x: null, // Cut selection
};

export const DEFAULT_INSERT_KEYS: Record<string, string | null> = {};

export function loadModalConfig(agentDir: string): ModalConfig {
  const configPath = join(agentDir, "modal.json");
  if (!existsSync(configPath)) {
    return {
      enabled: true,
      initialMode: "insert",
      keymaps: {
        normal: {},
        visual: {},
        insert: {},
      },
    };
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as ModalConfig;
    return {
      enabled: parsed.enabled ?? true,
      initialMode: parsed.initialMode ?? "insert",
      keymaps: {
        normal: parsed.keymaps?.normal ?? {},
        visual: parsed.keymaps?.visual ?? {},
        insert: parsed.keymaps?.insert ?? {},
      },
    };
  } catch {
    return {
      enabled: true,
      initialMode: "insert",
      keymaps: {
        normal: {},
        visual: {},
        insert: {},
      },
    };
  }
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
