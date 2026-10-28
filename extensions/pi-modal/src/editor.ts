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
  private promptChar = "❯";
  private keymaps: ReturnType<typeof resolveEffectiveKeymaps>;
  private selectionAnchor: { line: number; col: number } | null = null;
  private yankedText = "";

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    config?: ModalConfig,
    options?: CustomEditorOptions,
  ) {
    super(tui, theme, keybindings, options);
    this.keymaps = resolveEffectiveKeymaps(config);
    if (config?.promptChar && [...config.promptChar].length === 1) {
      this.promptChar = config.promptChar;
    }
    if (config?.initialMode) {
      this.mode = config.initialMode;
      if (config.initialMode === "visual") {
        this.selectionAnchor = { line: 0, col: 0 };
      }
    }
  }

  getPromptChar(): string {
    return this.promptChar;
  }

  getMode(): EditorMode {
    return this.mode;
  }

  setMode(mode: EditorMode): void {
    this.mode = mode;
    if (mode === "visual" && !this.selectionAnchor) {
      this.selectionAnchor = { ...this.getCursor() };
    } else if (mode !== "visual") {
      this.selectionAnchor = null;
    }
  }

  getSelectionAnchor(): { line: number; col: number } | null {
    return this.selectionAnchor ? { ...this.selectionAnchor } : null;
  }

  getYankedText(): string {
    return this.yankedText;
  }

  getSelection(): {
    start: { line: number; col: number };
    end: { line: number; col: number };
    text: string;
  } | null {
    if (this.mode !== "visual" || !this.selectionAnchor) return null;
    return this.resolveSelection();
  }

  getKeymaps() {
    return this.keymaps;
  }

  private resolveSelection(): {
    start: { line: number; col: number };
    end: { line: number; col: number };
    text: string;
  } | null {
    if (!this.selectionAnchor) return null;
    const anchor = this.selectionAnchor;
    const cursor = this.getCursor();
    const lines = this.getLines();

    let start: { line: number; col: number };
    let end: { line: number; col: number };

    if (
      cursor.line < anchor.line ||
      (cursor.line === anchor.line && cursor.col < anchor.col)
    ) {
      start = { line: cursor.line, col: cursor.col };
      end = { line: anchor.line, col: anchor.col };
    } else {
      start = { line: anchor.line, col: anchor.col };
      end = { line: cursor.line, col: cursor.col };
    }

    let text = "";
    if (start.line === end.line) {
      const line = lines[start.line] ?? "";
      text = line.slice(start.col, end.col + 1);
    } else {
      const parts: string[] = [];
      parts.push((lines[start.line] ?? "").slice(start.col));
      for (let l = start.line + 1; l < end.line; l++) {
        parts.push(lines[l] ?? "");
      }
      parts.push((lines[end.line] ?? "").slice(0, end.col + 1));
      text = parts.join("\n");
    }

    return { start, end, text };
  }

  private copyToClipboard(text: string): void {
    this.yankedText = text;
    if (!text) return;
    try {
      if (typeof this.tui?.terminal?.write === "function") {
        const b64 = Buffer.from(text).toString("base64");
        this.tui.terminal.write(`\x1b]52;c;${b64}\x07`);
      }
    } catch {
      // ignore clipboard write errors in test or headless envs
    }
  }

  private deleteSelection(selection: {
    start: { line: number; col: number };
    end: { line: number; col: number };
  }): void {
    const lines = this.getLines();
    const { start, end } = selection;

    let newLines: string[];
    if (start.line === end.line) {
      const line = lines[start.line] ?? "";
      const before = line.slice(0, start.col);
      const after = line.slice(end.col + 1);
      newLines = [
        ...lines.slice(0, start.line),
        before + after,
        ...lines.slice(start.line + 1),
      ];
    } else {
      const firstLine = lines[start.line] ?? "";
      const lastLine = lines[end.line] ?? "";
      const before = firstLine.slice(0, start.col);
      const after = lastLine.slice(end.col + 1);
      const merged = before + after;
      newLines = [
        ...lines.slice(0, start.line),
        merged,
        ...lines.slice(end.line + 1),
      ];
    }

    const newText = newLines.join("\n");
    this.setText(newText);

    const internalState = this as unknown as {
      state?: { cursorLine: number; cursorCol: number };
      preferredVisualCol?: number | null;
    };
    if (internalState.state) {
      const currentLines = this.getLines();
      const targetLine = Math.min(
        start.line,
        Math.max(0, currentLines.length - 1),
      );
      internalState.state.cursorLine = targetLine;
      const targetLineLen = currentLines[targetLine]?.length ?? 0;
      internalState.state.cursorCol = Math.min(start.col, targetLineLen);
      internalState.preferredVisualCol = null;
    }
  }

  override handleInput(data: string): void {
    // Escape key handling
    if (matchesKey(data, "escape")) {
      if (this.isShowingAutocomplete()) {
        super.handleInput(data);
        return;
      }
      if (this.mode === "visual") {
        this.selectionAnchor = null;
        this.mode = "normal";
        return;
      }
      if (this.mode === "insert") {
        this.mode = "normal";
        return;
      }
      super.handleInput(data); // Pass to super in normal mode (app interrupt, etc.)
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
        this.selectionAnchor = null;
        this.mode = "normal";
        return;
      }

      // Yank (y)
      if (data === "y") {
        const sel = this.resolveSelection();
        if (sel) {
          this.copyToClipboard(sel.text);
        }
        this.selectionAnchor = null;
        this.mode = "normal";
        return;
      }

      // Cut / Delete (d or x)
      if (data === "d" || data === "x") {
        const sel = this.resolveSelection();
        if (sel) {
          this.copyToClipboard(sel.text);
          this.deleteSelection(sel);
        }
        this.selectionAnchor = null;
        this.mode = "normal";
        return;
      }

      // Change (c)
      if (data === "c") {
        const sel = this.resolveSelection();
        if (sel) {
          this.copyToClipboard(sel.text);
          this.deleteSelection(sel);
        }
        this.selectionAnchor = null;
        this.mode = "insert";
        return;
      }

      // Movement keys from keymaps.visual
      if (data in this.keymaps.visual) {
        const seq = this.keymaps.visual[data];
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
        this.selectionAnchor = { ...this.getCursor() };
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

    if (this.mode === "visual" && this.selectionAnchor) {
      const sel = this.resolveSelection();
      if (sel) {
        const firstContentIdx = 1;
        const lastContentIdx = lines.length - 2;
        const scrollOffset =
          (this as unknown as { scrollOffset?: number }).scrollOffset ?? 0;

        for (let idx = firstContentIdx; idx <= lastContentIdx; idx++) {
          const logicalLineIdx = scrollOffset + (idx - firstContentIdx);
          if (
            logicalLineIdx >= sel.start.line &&
            logicalLineIdx <= sel.end.line
          ) {
            const currentLineText = this.getLines()[logicalLineIdx] ?? "";
            const selStartCol =
              logicalLineIdx === sel.start.line ? sel.start.col : 0;
            const selEndCol =
              logicalLineIdx === sel.end.line
                ? sel.end.col
                : Math.max(0, currentLineText.length - 1);
            const pad = this.getPaddingX();
            lines[idx] = highlightLineSelection(
              lines[idx] ?? "",
              pad + selStartCol,
              pad + selEndCol,
            );
          }
        }
      }
    }

    if (lines.length >= 3) {
      const firstContentIdx = 1;
      const lastContentIdx = lines.length - 2;
      const prefix = `${this.promptChar} `;
      const prefixWidth = visibleWidth(prefix);
      const indent = " ".repeat(prefixWidth);

      for (let idx = firstContentIdx; idx <= lastContentIdx; idx++) {
        const p = idx === firstContentIdx ? prefix : indent;
        const line = lines[idx] ?? "";
        const decorated = truncateToWidth(p + line, width, "");
        const diff = width - visibleWidth(decorated);
        lines[idx] = diff > 0 ? decorated + " ".repeat(diff) : decorated;
      }
    }

    const label = ` ${this.mode.toUpperCase()} `;
    const last = lines.length - 1;
    const lastLine = lines[last];
    if (lastLine !== undefined && visibleWidth(lastLine) >= label.length) {
      lines[last] = truncateToWidth(lastLine, width - label.length, "") + label;
    }
    return lines;
  }
}

function highlightLineSelection(
  line: string,
  selStartCol: number,
  selEndCol: number,
): string {
  if (selStartCol > selEndCol) return line;

  let result = "";
  let visibleCol = 0;
  let inSelection = false;
  let selectedBuffer = "";

  let i = 0;
  while (i < line.length) {
    if (line.charCodeAt(i) === 27) {
      let endIdx = i + 1;
      if (line[endIdx] === "[") {
        endIdx++;
        while (endIdx < line.length && line.charCodeAt(endIdx) < 64) {
          endIdx++;
        }
        if (endIdx < line.length) endIdx++;
      } else if (line[endIdx] === "_" || line[endIdx] === "]") {
        while (
          endIdx < line.length &&
          line[endIdx] !== "\x07" &&
          !(line[endIdx] === "\x1b" && line[endIdx + 1] === "\\")
        ) {
          endIdx++;
        }
        if (line[endIdx] === "\x07") endIdx++;
        else if (line[endIdx] === "\x1b" && line[endIdx + 1] === "\\")
          endIdx += 2;
      } else {
        endIdx++;
      }
      const ansiCode = line.slice(i, endIdx);
      i = endIdx;

      const inSelRange = visibleCol >= selStartCol && visibleCol <= selEndCol;
      if (
        (inSelRange ||
          (visibleCol === selEndCol + 1 && ansiCode === "\x1b[0m")) &&
        (ansiCode === "\x1b[7m" ||
          ansiCode === "\x1b[27m" ||
          ansiCode === "\x1b[0m")
      ) {
        continue;
      }

      if (inSelection) {
        selectedBuffer += ansiCode;
      } else {
        result += ansiCode;
      }
      continue;
    }

    const char = line[i] ?? "";
    const charWidth = visibleWidth(char);
    const isSelected = visibleCol >= selStartCol && visibleCol <= selEndCol;

    if (isSelected) {
      if (!inSelection) {
        inSelection = true;
      }
      selectedBuffer += char;
    } else {
      if (inSelection) {
        result += `\x1b[7m${selectedBuffer}\x1b[27m`;
        selectedBuffer = "";
        inSelection = false;
      }
      result += char;
    }

    visibleCol += charWidth;
    i++;
  }

  if (inSelection && selectedBuffer.length > 0) {
    result += `\x1b[7m${selectedBuffer}\x1b[27m`;
  }

  return result;
}
