import { type ModalConfig, resolveEffectiveKeymaps } from "./keymap.js";

const SEQUENCE_LABELS: Record<string, string> = {
  "\x1b[D": "move left",
  "\x1b[B": "move down",
  "\x1b[A": "move up",
  "\x1b[C": "move right",
  "\x1bf": "next word",
  "\x1bb": "previous word",
  "\x01": "line start",
  "\x05": "line end",
  "\x1b[3~": "delete character",
  "\x1a": "undo",
};

const MODE_ACTIONS: Record<string, string> = {
  i: "insert before cursor",
  a: "insert after cursor",
  I: "insert at line start",
  A: "insert at line end",
  o: "open line below and insert",
  v: "visual mode",
  y: "yank selection",
  d: "cut selection",
  x: "cut selection",
  c: "change selection",
};

function actionLabel(key: string, sequence: string | null): string {
  if (sequence === null) return MODE_ACTIONS[key] ?? "mode action";
  return SEQUENCE_LABELS[sequence] ?? `send ${JSON.stringify(sequence)}`;
}

function mapLines(
  title: string,
  keys: Record<string, string | null>,
): string[] {
  const entries = Object.entries(keys);
  if (entries.length === 0) return [title, "  (none)"];
  return [
    title,
    ...entries.map(
      ([key, sequence]) => `  ${key.padEnd(4)} ${actionLabel(key, sequence)}`,
    ),
  ];
}

export function formatVimKeys(config?: ModalConfig): string {
  const maps = resolveEffectiveKeymaps(config);
  const sections: string[] = ["pi-modal vim keybinds", ""];

  sections.push(...mapLines("Normal mode", maps.normal), "");
  sections.push(
    "  :    command mode",
    "  /    search",
    "  n    next match",
    "  N    previous match",
    "  Esc  pass to app",
    "",
  );

  sections.push("Insert mode", "  Esc  normal mode");
  const insertEntries = Object.entries(maps.insert);
  if (insertEntries.length > 0) {
    sections.push(
      ...insertEntries.map(
        ([key, sequence]) =>
          `  ${key.padEnd(4)} ${sequence === null ? "normal mode" : actionLabel(key, sequence)}`,
      ),
    );
  }
  sections.push("");

  sections.push(...mapLines("Visual mode", maps.visual), "");
  sections.push("  Esc  normal mode", "");

  sections.push(
    "Command mode",
    "  :%s/old/new/g  substitute",
    "  Enter          run",
    "  Esc            cancel",
    "",
    "Search mode",
    "  Enter  jump to match",
    "  Esc    cancel",
  );

  return sections.join("\n");
}
