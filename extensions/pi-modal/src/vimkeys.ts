import {
  InteractiveMode,
  type Theme,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { type Component, type Container, Spacer } from "@earendil-works/pi-tui";
import { getActiveTuiConfig } from "@hollowheap/ui/state";
import { type ModalConfig, resolveEffectiveKeymaps } from "./keymap.js";
import { panelRenderConfig } from "./panel.js";
import { loadModalConfig } from "./settings.js";
import {
  getPanelOrFallbackInnerWidth,
  renderPanelOrFallback,
} from "./skill-panel.js";

const HOTKEYS_PANEL = Symbol.for("@hollowheap/pi-modal/hotkeys-panel");

const SEQUENCE_LABELS: Record<string, string> = {
  "\x1b[D": "move left",
  "\x1b[B": "move down",
  "\x1b[A": "move up",
  "\x1b[C": "move right",
  "\x1bf": "next word",
  "\x1bb": "previous word",
  "\x1bF": "end of word",
  "\x01": "line start",
  "\x05": "line end",
  "\x1b[3~": "delete character",
  "\x1a": "undo",
  "\x1f": "undo",
  "\x12": "redo",
};

const MODE_ACTIONS: Record<string, string> = {
  dd: "delete line",
  yy: "yank line",
  p: "paste",
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
  if (sequence === null) {
    return Object.hasOwn(MODE_ACTIONS, key) ? MODE_ACTIONS[key] : "mode action";
  }
  return Object.hasOwn(SEQUENCE_LABELS, sequence)
    ? SEQUENCE_LABELS[sequence]
    : `send ${JSON.stringify(sequence)}`;
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

function escapeMarkdownKey(key: string): string {
  return key.replace(/\|/g, "\\|").replace(/`/g, "\\`");
}

export function formatVimHotkeysMarkdown(config?: ModalConfig): string {
  const maps = resolveEffectiveKeymaps(config);
  const lines: string[] = [
    "**Vim Mode (pi-modal)**",
    "| Key | Action |",
    "|-----|--------|",
  ];

  for (const [key, sequence] of Object.entries(maps.normal)) {
    lines.push(
      `| \`${escapeMarkdownKey(key)}\` | Normal: ${actionLabel(key, sequence)} |`,
    );
  }
  lines.push(
    "| `:` | Normal: command mode |",
    "| `/` | Normal: search |",
    "| `n` / `N` | Normal: next / previous match |",
    "| `Esc` | Insert / Visual: normal mode (pass to app in normal) |",
  );
  for (const [key, sequence] of Object.entries(maps.insert)) {
    const label =
      sequence === null || sequence === "normal"
        ? "normal mode"
        : actionLabel(key, sequence);
    lines.push(`| \`${escapeMarkdownKey(key)}\` | Insert: ${label} |`);
  }
  for (const [key, sequence] of Object.entries(maps.visual)) {
    lines.push(
      `| \`${escapeMarkdownKey(key)}\` | Visual: ${actionLabel(key, sequence)} |`,
    );
  }
  lines.push("| `:%s/old/new/g` | Command: substitute |");

  return lines.join("\n");
}

/** Contribute vim keybinds directly into the host `/hotkeys` section and frame it when panel is enabled. */
export function installHotkeysPanel(
  getTheme: () => Theme | undefined,
  getConfig: () => ModalConfig = () => loadModalConfig(getAgentDir()),
): void {
  const prototype = InteractiveMode.prototype;
  const installed = Reflect.get(prototype, HOTKEYS_PANEL) as
    | {
        getTheme: typeof getTheme;
        getConfig: typeof getConfig;
      }
    | undefined;
  if (installed) {
    installed.getTheme = getTheme;
    installed.getConfig = getConfig;
    return;
  }
  const original = Reflect.get(prototype, "handleHotkeysCommand");
  if (typeof original !== "function") return;
  const patch = { getTheme, getConfig };
  Reflect.set(prototype, HOTKEYS_PANEL, patch);
  Reflect.set(
    prototype,
    "handleHotkeysCommand",
    function (this: InteractiveMode) {
      const chatContainer = Reflect.get(this, "chatContainer") as
        | Container
        | undefined;
      const beforeCount = chatContainer?.children.length ?? 0;
      original.call(this);
      if (!chatContainer || chatContainer.children.length <= beforeCount) {
        return;
      }

      const added = chatContainer.children.slice(beforeCount);
      const modalConfig = patch.getConfig();
      if (modalConfig.enabled !== false) {
        const vimSection = formatVimHotkeysMarkdown(modalConfig);
        for (const child of added) {
          const text = Reflect.get(child, "text");
          const setText = Reflect.get(child, "setText");
          if (typeof text === "string" && text.includes("**Navigation**")) {
            const combined = `${text.trimEnd()}\n\n${vimSection}`;
            if (typeof setText === "function") {
              setText.call(child, combined);
            } else {
              Reflect.set(child, "text", combined);
              child.invalidate?.();
            }
            break;
          }
        }
      }

      const config = getActiveTuiConfig();
      const panel = panelRenderConfig(config);
      if (!panel.enabled) {
        return;
      }

      for (const child of added) {
        chatContainer.removeChild(child);
      }

      const innerChildren = added.filter(
        (child, index) =>
          index > 0 &&
          index < added.length - 1 &&
          child.constructor?.name !== "DynamicBorder",
      );
      for (const child of innerChildren) {
        if (typeof Reflect.get(child, "paddingX") === "number") {
          Reflect.set(child, "paddingX", 0);
        }
        if (typeof Reflect.get(child, "paddingY") === "number") {
          Reflect.set(child, "paddingY", 0);
        }
        child.invalidate?.();
      }

      chatContainer.addChild(new Spacer(1));
      const panelComponent: Component = {
        invalidate: () => {
          for (const child of innerChildren) {
            child.invalidate?.();
          }
        },
        render: (width: number) => {
          const currentPad = Reflect.get(this, "outputPad");
          const pad = typeof currentPad === "number" ? currentPad : 1;
          const theme = patch.getTheme();
          const innerWidth = getPanelOrFallbackInnerWidth(width, pad);
          const lines = innerChildren.flatMap((child) =>
            child.render(innerWidth),
          );
          return renderPanelOrFallback(lines, width, pad, theme);
        },
      };
      chatContainer.addChild(panelComponent);
    },
  );
}
