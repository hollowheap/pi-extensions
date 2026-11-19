import type { BorderStyle } from "@hollowheap/core/border";

export type { BorderStyle } from "@hollowheap/core/border";

export type EditorMode = "normal" | "insert" | "visual";

export interface ModalKeymapConfig {
  normal?: Record<string, string | null>;
  visual?: Record<string, string | null>;
  insert?: Record<string, string | null>;
}

export interface ModalConfig {
  enabled?: boolean;
  initialMode?: EditorMode;
  promptChar?: string;
  borderStyle?: BorderStyle;
  borderStyleExplicit?: boolean;
  keymaps?: ModalKeymapConfig;
}

export const DEFAULT_NORMAL_KEYS: Record<string, string | null> = {
  h: "\x1b[D",
  j: "\x1b[B",
  k: "\x1b[A",
  l: "\x1b[C",
  w: "\x1bf",
  b: "\x1bb",
  e: "\x1bF",
  "0": "\x01",
  $: "\x05",
  gg: "\x01",
  G: "\x05",
  dd: null,
  yy: null,
  p: null,
  x: "\x1b[3~",
  u: "\x1f",
  "\x12": "\x12",
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
