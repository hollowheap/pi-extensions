import {
  CustomEditor,
  type CustomEditorOptions,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  type EditorTheme,
  type TUI,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  type EditorMode,
  type ModalConfig,
  resolveEffectiveKeymaps,
} from "./keymap.js";

export class ModalEditor extends CustomEditor {
  private mode: EditorMode = "insert";
  private keymaps: ReturnType<typeof resolveEffectiveKeymaps>;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    config?: ModalConfig,
    options?: CustomEditorOptions,
  ) {
    super(tui, theme, keybindings, options);
    this.keymaps = resolveEffectiveKeymaps(config);
    if (config?.initialMode) {
      this.mode = config.initialMode;
    }
  }

  getMode(): EditorMode {
    return this.mode;
  }

  setMode(mode: EditorMode): void {
    this.mode = mode;
  }

  getKeymaps() {
    return this.keymaps;
  }

  override handleInput(data: string): void {
    // Escape key handling
    if (matchesKey(data, "escape")) {
      if (this.isShowingAutocomplete()) {
        super.handleInput(data);
        return;
      }
      if (this.mode === "insert" || this.mode === "visual") {
        this.mode = "normal";
      } else {
        super.handleInput(data); // Pass to super in normal mode (app interrupt, etc.)
      }
      return;
    }

    // Insert mode handling
    if (this.mode === "insert") {
      if (data in this.keymaps.insert) {
        const seq = this.keymaps.insert[data];
        if (seq === null || seq === "normal") {
          this.mode = "normal";
          return;
        }
        if (seq) {
          super.handleInput(seq);
          return;
        }
      }
      super.handleInput(data);
      return;
    }

    // Visual mode handling
    if (this.mode === "visual") {
      if (data === "v" || matchesKey(data, "escape")) {
        this.mode = "normal";
        return;
      }
      if (data in this.keymaps.visual) {
        const seq = this.keymaps.visual[data];
        if (data === "y" || data === "d" || data === "x") {
          this.mode = "normal";
          if (seq) super.handleInput(seq);
          return;
        }
        if (seq) {
          super.handleInput(seq);
          return;
        }
      }
      // Pass control sequences, block arbitrary typing
      if (data.length === 1 && data.charCodeAt(0) >= 32) return;
      super.handleInput(data);
      return;
    }

    // Normal mode handling
    if (data in this.keymaps.normal) {
      const seq = this.keymaps.normal[data];
      if (typeof seq === "string") {
        super.handleInput(seq);
        return;
      }
      if (data === "i") {
        this.mode = "insert";
      } else if (data === "a") {
        this.mode = "insert";
        super.handleInput("\x1b[C"); // Move right first
      } else if (data === "I") {
        this.mode = "insert";
        super.handleInput("\x01"); // Move to start of line
      } else if (data === "A") {
        this.mode = "insert";
        super.handleInput("\x05"); // Move to end of line
      } else if (data === "o") {
        this.mode = "insert";
        super.handleInput("\x05\n"); // End of line + newline
      } else if (data === "v") {
        this.mode = "visual";
      }
      return;
    }

    // Pass control sequences (Ctrl+C, Ctrl+D, etc.) through to CustomEditor; ignore printable chars
    if (data.length === 1 && data.charCodeAt(0) >= 32) return;
    super.handleInput(data);
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length === 0) return lines;

    const label = ` ${this.mode.toUpperCase()} `;
    const last = lines.length - 1;
    const lastLine = lines[last];
    if (lastLine !== undefined && visibleWidth(lastLine) >= label.length) {
      lines[last] = truncateToWidth(lastLine, width - label.length, "") + label;
    }
    return lines;
  }
}
