import {
  CustomEditor,
  type CustomEditorOptions,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type EditorTheme,
  type TUI,
  matchesKey,
  parseKey,
  sliceByColumn,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

import { getBorderChars } from "@hollowheap/core/border";
import {
  type EditorMode,
  type ModalConfig,
  resolveEffectiveKeymaps,
} from "./keymap.js";

function getGraphemeEnd(text: string, col: number): number {
  if (col < 0) return 0;
  if (col >= text.length) return text.length;
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  for (const seg of segmenter.segment(text)) {
    if (col >= seg.index && col < seg.index + seg.segment.length) {
      return seg.index + seg.segment.length;
    }
  }
  return col + 1;
}

export class ModalEditor extends CustomEditor {
  private mode: EditorMode = "insert";
  private promptChar = "❯";
  private borderStyle = "rounded";
  private keymaps: ReturnType<typeof resolveEffectiveKeymaps>;
  private selectionAnchor: { line: number; col: number } | null = null;
  private yankedText = "";
  private searchQuery = "";
  private lastSearchQuery = "";
  private searchMode = false;
  private clipboardError: string | undefined;
  private commandMode = false;
  private commandBuffer = "";
  private pendingChange = false;
  private lastBottomBorder: string | undefined;
  private modeTheme: Theme | undefined;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    config?: ModalConfig,
    options?: CustomEditorOptions,
    modeTheme?: Theme,
  ) {
    super(tui, theme, keybindings, options);
    this.modeTheme = modeTheme;
    this.keymaps = resolveEffectiveKeymaps(config);
    if (config?.promptChar && [...config.promptChar].length === 1) {
      this.promptChar = config.promptChar;
    }
    if (config?.borderStyle) {
      this.borderStyle = config.borderStyle;
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

  getClipboardError(): string | undefined {
    return this.clipboardError;
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
      const endCol = getGraphemeEnd(line, end.col);
      text = line.slice(start.col, endCol);
    } else {
      const parts: string[] = [];
      parts.push((lines[start.line] ?? "").slice(start.col));
      for (let l = start.line + 1; l < end.line; l++) {
        parts.push(lines[l] ?? "");
      }
      const lastLine = lines[end.line] ?? "";
      const endCol = getGraphemeEnd(lastLine, end.col);
      parts.push(lastLine.slice(0, endCol));
      text = parts.join("\n");
    }

    return { start, end, text };
  }

  private copyToClipboard(text: string): void {
    this.yankedText = text;
    if (!text) return;
    const b64 = Buffer.from(text).toString("base64");
    const sequence = `\x1b]52;c;${b64}\x07`;
    try {
      const write = this.tui?.terminal?.write;
      if (typeof write === "function") {
        write.call(this.tui.terminal, sequence);
      } else {
        process.stdout.write(sequence);
      }
      this.clipboardError = undefined;
    } catch (error) {
      this.clipboardError =
        error instanceof Error ? error.message : String(error);
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
      const endCol = getGraphemeEnd(line, end.col);
      const after = line.slice(endCol);
      newLines = [
        ...lines.slice(0, start.line),
        before + after,
        ...lines.slice(start.line + 1),
      ];
    } else {
      const firstLine = lines[start.line] ?? "";
      const lastLine = lines[end.line] ?? "";
      const before = firstLine.slice(0, start.col);
      const endCol = getGraphemeEnd(lastLine, end.col);
      const after = lastLine.slice(endCol);
      const merged = before + after;
      newLines = [
        ...lines.slice(0, start.line),
        merged,
        ...lines.slice(end.line + 1),
      ];
    }

    this.setText(newLines.join("\n"));
    this.moveCursorTo(start.line, start.col);
  }

  private moveCursorTo(line: number, col: number): void {
    const lines = this.getLines();
    const targetLine = Math.max(0, Math.min(line, lines.length - 1));
    const targetCol = Math.max(
      0,
      Math.min(col, (lines[targetLine] ?? "").length),
    );
    const current = this.getCursor();
    const direction = targetLine > current.line ? "\x1b[B" : "\x1b[A";
    for (let i = 0; i < Math.abs(targetLine - current.line); i++) {
      super.handleInput(direction);
    }
    super.handleInput("\x01");
    for (let i = 0; i < targetCol; i++) {
      super.handleInput("\x1b[C");
    }
  }

  private findMatch(
    query: string,
    direction: 1 | -1,
  ): { line: number; col: number } | null {
    if (query === "") return null;
    const lines = this.getLines();
    if (lines.length === 0) return null;
    const cursor = this.getCursor();
    for (let step = 1; step <= lines.length; step++) {
      const line =
        (((cursor.line + direction * step) % lines.length) + lines.length) %
        lines.length;
      const text = lines[line] ?? "";
      const startCol =
        step === lines.length
          ? direction > 0
            ? 0
            : text.length - 1
          : line === cursor.line
            ? direction > 0
              ? cursor.col + 1
              : cursor.col - 1
            : direction > 0
              ? 0
              : text.length - 1;
      const col =
        direction > 0
          ? text.indexOf(query, startCol)
          : text.lastIndexOf(query, Math.max(0, startCol));
      if (col >= 0) return { line, col };
    }
    return null;
  }

  private moveToMatch(query: string, direction: 1 | -1): void {
    const match = this.findMatch(query, direction);
    if (match) this.moveCursorTo(match.line, match.col);
  }

  override handleInput(data: string): void {
    const printable = printableKey(data);
    const input = printable ?? data;

    // Search mode handling
    if (this.searchMode) {
      if (matchesKey(data, "enter")) {
        this.searchMode = false;
        this.lastSearchQuery = this.searchQuery;
        this.moveToMatch(this.searchQuery, 1);
        return;
      }
      if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
        this.searchMode = false;
        this.searchQuery = "";
        return;
      }
      if (printable !== undefined) {
        this.searchQuery += printable;
        return;
      }
      return;
    }

    // Command mode handling
    if (this.commandMode) {
      if (matchesKey(data, "enter")) {
        this.commandMode = false;
        const cmd = this.commandBuffer;
        this.commandBuffer = "";
        // Handle :%s/old/new/g
        const subMatch = cmd.match(/^:%s\/([^/]*)\/([^/]*)\/(g?)$/);
        if (subMatch && subMatch[1] !== "") {
          const from = subMatch[1];
          const to = subMatch[2] ?? "";
          const text = this.getText();
          const next =
            subMatch[3] === "g"
              ? text.split(from).join(to)
              : text.replace(from, to);
          if (next !== text) {
            const cursor = this.getCursor();
            this.setText(next);
            this.moveCursorTo(cursor.line, cursor.col);
          }
        }
        return;
      }
      if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
        this.commandMode = false;
        this.commandBuffer = "";
        return;
      }
      if (printable !== undefined) {
        this.commandBuffer += printable;
        return;
      }
      return;
    }

    // Escape key handling
    if (matchesKey(data, "escape")) {
      this.pendingChange = false;
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
      if (input === "v" || matchesKey(data, "escape")) {
        this.selectionAnchor = null;
        this.mode = "normal";
        return;
      }

      // Yank (y)
      if (input === "y") {
        const sel = this.resolveSelection();
        if (sel) {
          this.copyToClipboard(sel.text);
        }
        this.selectionAnchor = null;
        this.mode = "normal";
        return;
      }

      // Cut / Delete (d or x)
      if (input === "d" || input === "x") {
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
      if (input === "c") {
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
      if (input in this.keymaps.visual) {
        const seq = this.keymaps.visual[input];
        if (seq) {
          super.handleInput(seq);
          return;
        }
      }

      // Pass control sequences, block arbitrary typing
      if (printable !== undefined) return;
      super.handleInput(data);
      return;
    }

    // Command mode for substitution
    if (this.mode === "normal" && input === ":") {
      // Enter command mode - collect until enter
      this.searchMode = false;
      // For simplicity, handle :%s in handleInput via a separate flag
      this.commandMode = true;
      this.commandBuffer = ":";
      return;
    }

    // Normal mode handling
    if (this.pendingChange) {
      this.pendingChange = false;
      if (input === "c") {
        this.changeLine();
        this.mode = "insert";
      } else if (input === "w") {
        this.changeWord();
        this.mode = "insert";
      } else if (input === "$") {
        this.changeToEndOfLine();
        this.mode = "insert";
      }
      return;
    }

    if (input === "/" && this.mode === "normal") {
      this.searchMode = true;
      this.searchQuery = "";
      return;
    }

    if ((input === "n" || input === "N") && this.lastSearchQuery !== "") {
      this.moveToMatch(this.lastSearchQuery, input === "n" ? 1 : -1);
      return;
    }

    if (input in this.keymaps.normal) {
      const seq = this.keymaps.normal[input];
      if (typeof seq === "string") {
        super.handleInput(seq);
        return;
      }
      if (input === "i") {
        this.mode = "insert";
      } else if (input === "a") {
        this.mode = "insert";
        super.handleInput("\x1b[C"); // Move right first
      } else if (input === "I") {
        this.mode = "insert";
        super.handleInput("\x01"); // Move to start of line
      } else if (input === "A") {
        this.mode = "insert";
        super.handleInput("\x05"); // Move to end of line
      } else if (input === "o") {
        this.mode = "insert";
        super.handleInput("\x05\n"); // End of line + newline
      } else if (input === "v") {
        this.mode = "visual";
        this.selectionAnchor = { ...this.getCursor() };
      }
      return;
    }

    if (input === "c") {
      this.pendingChange = true;
      return;
    }

    if (input === "C") {
      this.changeToEndOfLine();
      this.mode = "insert";
      return;
    }

    // Pass control sequences (Ctrl+C, Ctrl+D, etc.) through to CustomEditor; ignore printable chars
    if (printable !== undefined) return;
    super.handleInput(data);
  }

  private changeToEndOfLine(): void {
    const cursor = this.getCursor();
    const line = this.getLines()[cursor.line] ?? "";
    if (cursor.col < line.length) {
      this.deleteSelection({
        start: cursor,
        end: { line: cursor.line, col: line.length - 1 },
      });
    }
  }

  private changeLine(): void {
    const cursor = this.getCursor();
    const line = this.getLines()[cursor.line] ?? "";
    if (line.length > 0) {
      this.deleteSelection({
        start: { line: cursor.line, col: 0 },
        end: { line: cursor.line, col: line.length - 1 },
      });
    }
  }

  private changeWord(): void {
    const cursor = this.getCursor();
    const line = this.getLines()[cursor.line] ?? "";
    let end = cursor.col;
    while (end < line.length && /\s/.test(line[end] ?? "")) end++;
    while (end < line.length && !/\s/.test(line[end] ?? "")) end++;
    if (end > cursor.col) {
      this.deleteSelection({
        start: cursor,
        end: { line: cursor.line, col: end - 1 },
      });
    }
  }

  private borderPaint(): (text: string) => string {
    const appTheme = this.modeTheme;
    if (!appTheme) return this.borderColor;
    if (this.searchMode) return (text) => appTheme.fg("success", text);
    if (this.commandMode) return (text) => appTheme.fg("error", text);
    if (this.getText().trimStart().startsWith("!")) {
      return appTheme.getBashModeBorderColor();
    }
    switch (this.mode) {
      case "insert":
        return (text) => appTheme.fg("accent", text);
      case "visual":
        return (text) => appTheme.fg("warning", text);
      default:
        return (text) => appTheme.fg("border", text);
    }
  }

  protected override renderTopBorder(
    width: number,
    hiddenLineCount: number,
  ): string {
    if (this.borderStyle === "none" || width < 2) {
      return super.renderTopBorder(width, hiddenLineCount);
    }
    const paint = this.borderPaint();
    const borderChars = getBorderChars(this.borderStyle);
    const innerWidth = width - 2;
    const inner =
      innerWidth > 0
        ? paint(
            stripTerminalSequences(
              super.renderTopBorder(innerWidth, hiddenLineCount),
            ),
          )
        : "";
    return paint(borderChars.topLeft) + inner + paint(borderChars.topRight);
  }

  protected override renderBottomBorder(
    width: number,
    hiddenLineCount: number,
  ): string {
    const label = ` ${this.getText().trimStart().startsWith("!") ? "BASH" : this.mode.toUpperCase()} `;
    if (this.borderStyle === "none" || width < 2) {
      const line = fitRightLabel(
        super.renderBottomBorder(width, hiddenLineCount),
        width,
        label,
      );
      this.lastBottomBorder = line;
      return line;
    }
    const paint = this.borderPaint();
    const borderChars = getBorderChars(this.borderStyle);
    const innerWidth = width - 2;
    const inner =
      innerWidth > 0
        ? paint(
            stripTerminalSequences(
              super.renderBottomBorder(innerWidth, hiddenLineCount),
            ),
          )
        : "";
    const line =
      paint(borderChars.bottomLeft) +
      fitRightLabel(inner, innerWidth, label) +
      paint(borderChars.bottomRight);
    this.lastBottomBorder = line;
    return line;
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length === 0) return lines;

    const paint = this.borderPaint();
    const promptPrefix = `${this.promptChar} `;
    const promptWidth = visibleWidth(promptPrefix);
    const borderEnabled =
      this.borderStyle !== "none" && width >= promptWidth + 2;
    const borderChars = borderEnabled ? getBorderChars(this.borderStyle) : null;
    const bottomIndex = this.lastBottomBorder
      ? lines.lastIndexOf(this.lastBottomBorder)
      : -1;
    if (bottomIndex < 2) return lines;

    const contentWidth = borderEnabled
      ? Math.max(1, width - promptWidth - 1)
      : Math.max(1, width - promptWidth);
    const firstContentIdx = 1;
    const lastContentIdx = bottomIndex - 1;
    const indent = " ".repeat(promptWidth);

    for (let idx = firstContentIdx; idx <= lastContentIdx; idx++) {
      const line = lines[idx] ?? "";
      const decorated = truncateToWidth(line, contentWidth, "");
      const diff = contentWidth - visibleWidth(decorated);
      lines[idx] = diff > 0 ? decorated + " ".repeat(diff) : decorated;
    }

    if (this.mode === "visual" && this.selectionAnchor) {
      const sel = this.resolveSelection();
      if (sel) {
        const contentLines = lastContentIdx - firstContentIdx + 1;
        const cursor = this.getCursor();
        const scrollOffset = Math.max(0, cursor.line - (contentLines - 1));
        const pad = this.getPaddingX();

        for (let idx = firstContentIdx; idx <= lastContentIdx; idx++) {
          const logicalLineIdx = scrollOffset + (idx - firstContentIdx);
          if (
            logicalLineIdx < sel.start.line ||
            logicalLineIdx > sel.end.line
          ) {
            continue;
          }
          const currentLineText = this.getLines()[logicalLineIdx] ?? "";
          const selStartCol =
            logicalLineIdx === sel.start.line ? sel.start.col : 0;
          const selEndCol =
            logicalLineIdx === sel.end.line
              ? sel.end.col
              : Math.max(0, currentLineText.length - 1);
          lines[idx] = highlightLineSelection(
            lines[idx] ?? "",
            pad + selStartCol,
            pad + selEndCol,
          );
        }
      }
    }

    if (borderEnabled && borderChars) {
      const vertical = paint(borderChars.vertical);
      for (let idx = firstContentIdx; idx <= lastContentIdx; idx++) {
        const gutter = idx === firstContentIdx ? promptPrefix : `${vertical} `;
        lines[idx] = gutter + (lines[idx] ?? "") + vertical;
      }
    } else {
      for (let idx = firstContentIdx; idx <= lastContentIdx; idx++) {
        const gutter = idx === firstContentIdx ? promptPrefix : indent;
        lines[idx] = gutter + (lines[idx] ?? "");
      }
    }
    return lines;
  }
}

function printableKey(data: string): string | undefined {
  if (data.length === 1 && data.charCodeAt(0) >= 32) return data;
  const key = parseKey(data);
  if (key === undefined) return undefined;
  if (key.length === 1) return key;
  const shifted = /^shift\+([a-z])$/.exec(key);
  return shifted?.[1]?.toUpperCase();
}

function fitRightLabel(line: string, width: number, label: string): string {
  if (width <= 0) return "";
  const text = truncateToWidth(label, width, "");
  const labelWidth = visibleWidth(text);
  const prefixWidth = Math.max(0, width - labelWidth);
  const prefix = sliceByColumn(line, 0, prefixWidth);
  const pad = Math.max(0, prefixWidth - visibleWidth(prefix));
  return `${prefix}\x1b[0m${" ".repeat(pad)}${text}`;
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
