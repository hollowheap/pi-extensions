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
import { errorMessage } from "@hollowheap/core/format";

import { type BorderStyle, getBorderChars } from "@hollowheap/core/border";
import type {
  OverlaySurfaceMode,
  TuiConfig,
} from "@hollowheap/core/tui-config";
import {
  getActiveTuiConfig,
  getHostOutputPadding,
} from "@hollowheap/tui/state";
import { paintSurfaceLine } from "@hollowheap/tui/surface";
import {
  type EditorMode,
  type ModalConfig,
  resolveEffectiveKeymaps,
} from "./keymap.js";
import { panelRenderConfig } from "./panel.js";

function formatEditorModeBadge(mode: EditorMode, isBash: boolean): string {
  if (isBash) return "BASH";
  return mode.toUpperCase();
}

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

function countGraphemes(text: string): number {
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  let count = 0;
  for (const _segment of segmenter.segment(text)) count++;
  return count;
}

export class ModalEditor extends CustomEditor {
  private mode: EditorMode = "insert";
  private customPromptChar: string | undefined;
  private explicitBorderStyle: BorderStyle | undefined;
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
  private pendingInsertChord = "";
  private pendingNormalChord = "";
  private lastBottomBorder: string | undefined;
  private renderSnapshot:
    | {
        width: number;
        config: TuiConfig;
        hostPad: number;
        panelEnabled: boolean;
        surface: OverlaySurfaceMode;
        surfaceActive: boolean;
        borderStyle: BorderStyle;
        promptPrefix: string;
        promptWidth: number;
        borderEnabled: boolean;
      }
    | undefined;
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
      this.customPromptChar = config.promptChar;
    }
    if (config?.borderStyle) {
      this.explicitBorderStyle = config.borderStyle;
    }

    if (config?.initialMode) {
      this.mode = config.initialMode;
      if (config.initialMode === "visual") {
        this.selectionAnchor = { line: 0, col: 0 };
      }
    }
  }

  getPromptChar(): string {
    if (this.customPromptChar !== undefined) return this.customPromptChar;
    return this.mode === "insert" ? "▎" : "█";
  }

  getMode(): EditorMode {
    return this.mode;
  }

  setMode(mode: EditorMode): void {
    if (this.mode === "insert" && mode !== "insert") {
      this.flushPendingInsertChord();
    }
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
      this.clipboardError = errorMessage(error);
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
    const graphemes = countGraphemes(
      (lines[targetLine] ?? "").slice(0, targetCol),
    );
    for (let i = 0; i < graphemes; i++) {
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
    const currentText = lines[cursor.line] ?? "";

    // Search the remainder of the current line first.
    if (direction > 0) {
      const col = currentText.indexOf(query, cursor.col + 1);
      if (col >= 0) return { line: cursor.line, col };
    } else if (cursor.col > 0) {
      const col = currentText.lastIndexOf(query, cursor.col - 1);
      if (col >= 0) return { line: cursor.line, col };
    }

    // Search all other lines in the requested direction.
    for (let step = 1; step < lines.length; step++) {
      const line =
        (((cursor.line + direction * step) % lines.length) + lines.length) %
        lines.length;
      const text = lines[line] ?? "";
      const col =
        direction > 0 ? text.indexOf(query, 0) : text.lastIndexOf(query);
      if (col >= 0) return { line, col };
    }

    // Wrap back onto the current line.
    const wrappedCol =
      direction > 0
        ? currentText.indexOf(query, 0)
        : currentText.lastIndexOf(query);
    return wrappedCol >= 0 ? { line: cursor.line, col: wrappedCol } : null;
  }

  private moveToMatch(query: string, direction: 1 | -1): void {
    const match = this.findMatch(query, direction);
    if (match) this.moveCursorTo(match.line, match.col);
  }

  private flushPendingInsertChord(): void {
    if (!this.pendingInsertChord) return;
    const pending = this.pendingInsertChord;
    this.pendingInsertChord = "";
    super.handleInput(pending);
  }

  private runNormalChord(chord: string): void {
    const sequence = this.keymaps.normal[chord];
    if (typeof sequence === "string") {
      super.handleInput(sequence);
      return;
    }
    if (chord === "dd") {
      this.deleteLine();
    } else if (chord === "yy") {
      const cursor = this.getCursor();
      this.copyToClipboard(this.getLines()[cursor.line] ?? "");
    }
  }

  private deleteLine(): void {
    const cursor = this.getCursor();
    const lines = this.getLines();
    this.copyToClipboard(lines[cursor.line] ?? "");
    const next = [...lines];
    next.splice(cursor.line, 1);
    if (next.length === 0) next.push("");
    this.setText(next.join("\n"));
    this.moveCursorTo(Math.min(cursor.line, next.length - 1), 0);
  }

  private paste(): void {
    if (this.yankedText === "") return;
    const cursor = this.getCursor();
    const lines = this.getLines();
    const line = lines[cursor.line] ?? "";
    const next = [...lines];
    next[cursor.line] =
      line.slice(0, cursor.col) + this.yankedText + line.slice(cursor.col);
    this.setText(next.join("\n"));
    const parts = this.yankedText.split("\n");
    const targetLine = cursor.line + parts.length - 1;
    const targetCol =
      parts.length === 1
        ? cursor.col + parts[0].length
        : (parts[parts.length - 1]?.length ?? 0);
    this.moveCursorTo(targetLine, targetCol);
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
      this.pendingNormalChord = "";
      this.flushPendingInsertChord();
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
      if (this.isShowingAutocomplete()) {
        this.flushPendingInsertChord();
        super.handleInput(data);
        return;
      }
      const chordKeys = Object.keys(this.keymaps.insert);
      if (chordKeys.length > 0) {
        const candidate = this.pendingInsertChord + data;
        if (
          chordKeys.some(
            (key) => key.length > candidate.length && key.startsWith(candidate),
          )
        ) {
          this.pendingInsertChord = candidate;
          return;
        }
        let matched: string | undefined;
        for (const key of chordKeys) {
          if (
            key.length <= candidate.length &&
            candidate.startsWith(key) &&
            (matched === undefined || key.length > matched.length)
          ) {
            matched = key;
          }
        }
        if (matched !== undefined) {
          this.pendingInsertChord = "";
          const seq = this.keymaps.insert[matched];
          if (seq === null || seq === "normal") {
            this.mode = "normal";
          } else if (seq) {
            super.handleInput(seq);
          } else {
            super.handleInput(candidate);
          }
          return;
        }
        this.flushPendingInsertChord();
      }
      super.handleInput(data);
      return;
    }

    // Visual mode handling
    if (this.mode === "visual") {
      if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
        this.selectionAnchor = null;
        this.mode = "normal";
        return;
      }

      const visualSeq = Object.hasOwn(this.keymaps.visual, input)
        ? this.keymaps.visual[input]
        : undefined;
      if (typeof visualSeq === "string" && visualSeq.length > 0) {
        super.handleInput(visualSeq);
        return;
      }

      if (input === "v") {
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

      // Pass control sequences, block arbitrary typing
      if (printable !== undefined) return;
      super.handleInput(data);
      return;
    }

    // Command mode for substitution
    if (this.mode === "normal" && input === ":") {
      // Enter command mode - collect until enter
      this.searchMode = false;
      this.pendingChange = false;
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
      this.pendingChange = false;
      this.searchMode = true;
      this.searchQuery = "";
      return;
    }

    if ((input === "n" || input === "N") && this.lastSearchQuery !== "") {
      this.moveToMatch(this.lastSearchQuery, input === "n" ? 1 : -1);
      return;
    }

    const normalChordKeys = Object.keys(this.keymaps.normal).filter(
      (key) => key.length > 1,
    );
    if (this.pendingNormalChord !== "") {
      const chord = this.pendingNormalChord + input;
      this.pendingNormalChord = "";
      if (Object.hasOwn(this.keymaps.normal, chord)) {
        this.runNormalChord(chord);
        return;
      }
    } else if (
      !Object.hasOwn(this.keymaps.normal, input) &&
      normalChordKeys.some((key) => key.startsWith(input))
    ) {
      this.pendingNormalChord = input;
      return;
    }

    if (Object.hasOwn(this.keymaps.normal, input)) {
      const seq = this.keymaps.normal[input];
      if (typeof seq === "string") {
        super.handleInput(seq);
        return;
      }
      if (input === "i") {
        this.mode = "insert";
      } else if (input === "a") {
        this.mode = "insert";
        const cursor = this.getCursor();
        const line = this.getLines()[cursor.line] ?? "";
        if (cursor.col < line.length) {
          super.handleInput("\x1b[C"); // Move right first
        }
      } else if (input === "I") {
        this.mode = "insert";
        super.handleInput("\x01"); // Move to start of line
      } else if (input === "A") {
        this.mode = "insert";
        super.handleInput("\x05"); // Move to end of line
      } else if (input === "o") {
        this.mode = "insert";
        super.handleInput("\x05");
        super.handleInput("\n");
      } else if (input === "v") {
        this.mode = "visual";
        this.selectionAnchor = { ...this.getCursor() };
      } else if (input === "p") {
        this.paste();
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
        end: { line: cursor.line, col: line.length },
      });
    }
  }

  private changeLine(): void {
    const cursor = this.getCursor();
    const line = this.getLines()[cursor.line] ?? "";
    if (line.length > 0) {
      this.deleteSelection({
        start: { line: cursor.line, col: 0 },
        end: { line: cursor.line, col: line.length },
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

  private borderPaint(
    colored = getActiveTuiConfig().colored,
    surfaceActive = false,
  ): (text: string) => string {
    if (!colored) {
      return (text) => text;
    }
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
        return (text) =>
          appTheme.fg(surfaceActive ? "borderAccent" : "border", text);
    }
  }

  private isSurfaceActive(
    surface: OverlaySurfaceMode,
    colored = getActiveTuiConfig().colored,
  ): boolean {
    return (
      surface !== "transparent" &&
      colored &&
      typeof this.modeTheme?.bg === "function"
    );
  }

  private getRenderSnapshot(targetWidth: number) {
    if (this.renderSnapshot && this.renderSnapshot.width === targetWidth) {
      return this.renderSnapshot;
    }
    const config = getActiveTuiConfig();
    const hostPad = getHostOutputPadding() ?? 0;
    const panel = panelRenderConfig(config);
    const panelEnabled =
      panel.enabled || this.explicitBorderStyle !== undefined;
    const surface: OverlaySurfaceMode = !panelEnabled
      ? "transparent"
      : (panel.surface ?? config.overlaySurface);
    const surfaceActive =
      panelEnabled && this.isSurfaceActive(surface, config.colored);
    const sharedBorderStyle: BorderStyle = !panelEnabled
      ? "none"
      : panel.borderStyle;
    const borderStyle = this.explicitBorderStyle ?? sharedBorderStyle;
    const promptPrefix = `${this.getPromptChar()} `;
    const promptWidth = visibleWidth(promptPrefix);
    const borderEnabled =
      panelEnabled && borderStyle !== "none" && targetWidth >= promptWidth + 2;
    return {
      width: targetWidth,
      config,
      hostPad,
      panelEnabled,
      surface,
      surfaceActive,
      borderStyle,
      promptPrefix,
      promptWidth,
      borderEnabled,
    };
  }

  /** Clear constructor overrides so live `/ui` settings take effect immediately. */
  clearExplicitUiOverrides(): void {
    this.explicitBorderStyle = undefined;
    this.lastBottomBorder = "";
    this.invalidate();
  }

  protected override renderTopBorder(
    width: number,
    hiddenLineCount: number,
  ): string {
    const targetWidth = this.renderSnapshot?.width ?? width;
    const { config, panelEnabled, surfaceActive, borderStyle, borderEnabled } =
      this.getRenderSnapshot(targetWidth);
    if (!panelEnabled) {
      return super.renderTopBorder(targetWidth, hiddenLineCount);
    }
    if (!borderEnabled) {
      const raw = super.renderTopBorder(targetWidth, hiddenLineCount);
      return (config.colored ? raw : stripTerminalSequences(raw)).replaceAll(
        "─",
        " ",
      );
    }
    const paint = this.borderPaint(config.colored, surfaceActive);
    const borderChars = getBorderChars(borderStyle);
    const innerWidth = targetWidth - 2;
    const inner =
      innerWidth > 0
        ? paint(
            stripTerminalSequences(
              super.renderTopBorder(innerWidth, hiddenLineCount),
            ).replaceAll("─", borderChars.horizontal),
          )
        : "";
    return paint(borderChars.topLeft) + inner + paint(borderChars.topRight);
  }

  protected override renderBottomBorder(
    width: number,
    hiddenLineCount: number,
  ): string {
    const targetWidth = this.renderSnapshot?.width ?? width;
    const { config, panelEnabled, surfaceActive, borderStyle, borderEnabled } =
      this.getRenderSnapshot(targetWidth);
    const showModeIndicator = config.modeIndicator !== false;
    const isBash = this.getText().trimStart().startsWith("!");
    const badge = formatEditorModeBadge(this.mode, isBash);
    const label = ` ${badge} `;
    if (!panelEnabled) {
      const base = super.renderBottomBorder(targetWidth, hiddenLineCount);
      const line = showModeIndicator
        ? fitRightLabel(base, targetWidth, label)
        : base;
      this.lastBottomBorder = line;
      return line;
    }
    if (!borderEnabled) {
      const innerWidth = targetWidth - 2;
      if (innerWidth > 0) {
        const inner = " ".repeat(innerWidth);
        const line = ` ${showModeIndicator ? fitRightLabel(inner, innerWidth, label) : inner} `;
        this.lastBottomBorder = line;
        return line;
      }
      const base = stripTerminalSequences(
        super.renderBottomBorder(targetWidth, hiddenLineCount),
      ).replaceAll("─", " ");
      const line = showModeIndicator
        ? fitRightLabel(base, targetWidth, label)
        : base;
      this.lastBottomBorder = line;
      return line;
    }
    const paint = this.borderPaint(config.colored, surfaceActive);
    const borderChars = getBorderChars(borderStyle);
    const innerWidth = targetWidth - 2;
    const inner =
      innerWidth > 0
        ? paint(
            stripTerminalSequences(
              super.renderBottomBorder(innerWidth, hiddenLineCount),
            ).replaceAll("─", borderChars.horizontal),
          )
        : "";
    const line =
      paint(borderChars.bottomLeft) +
      (showModeIndicator ? fitRightLabel(inner, innerWidth, label) : inner) +
      paint(borderChars.bottomRight);
    this.lastBottomBorder = line;
    return line;
  }

  override render(width: number): string[] {
    const snapshot = this.getRenderSnapshot(width);
    if (!snapshot.panelEnabled) {
      this.renderSnapshot = snapshot;
      try {
        return super.render(width);
      } finally {
        this.renderSnapshot = undefined;
      }
    }
    const {
      config,
      surface,
      surfaceActive,
      borderStyle,
      promptPrefix,
      promptWidth,
      borderEnabled,
    } = snapshot;
    const { colored } = config;
    const paint = this.borderPaint(colored, surfaceActive);
    const borderChars = borderEnabled ? getBorderChars(borderStyle) : null;
    const hasBorderSpace = width >= promptWidth + 2;
    const borderRightPad = hasBorderSpace && width >= promptWidth + 3 ? 1 : 0;
    const contentWidth = hasBorderSpace
      ? Math.max(1, width - promptWidth - 1 - borderRightPad)
      : Math.max(1, width - promptWidth);
    const paddingX = Math.min(
      this.getPaddingX(),
      Math.max(0, Math.floor((width - 1) / 2)),
    );
    const hostWidth = Math.max(
      1,
      contentWidth + paddingX * 2 + (paddingX === 0 ? 1 : 0),
    );
    let lines: string[] = [];
    this.renderSnapshot = snapshot;
    try {
      lines = super.render(hostWidth);
    } finally {
      this.renderSnapshot = undefined;
    }
    if (lines.length === 0) return lines;

    const bottomIndex = this.lastBottomBorder
      ? lines.lastIndexOf(this.lastBottomBorder)
      : -1;
    if (bottomIndex < 2) return lines;
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
        const pad = this.getPaddingX();
        const logicalLines = this.getLines();
        const visualRows = lines.slice(firstContentIdx, lastContentIdx + 1);
        const mapping = mapVisualLinesToLogical(visualRows, logicalLines, pad);

        for (let offsetIdx = 0; offsetIdx < mapping.length; offsetIdx++) {
          const entry = mapping[offsetIdx];
          if (!entry) continue;
          const { logicalLine, startCol, endCol } = entry;
          if (logicalLine < sel.start.line || logicalLine > sel.end.line) {
            continue;
          }
          const logicalText = logicalLines[logicalLine] ?? "";
          const lineSelStart =
            logicalLine === sel.start.line ? sel.start.col : 0;
          const lineSelEndExclusive =
            logicalLine === sel.end.line
              ? getGraphemeEnd(logicalText, sel.end.col)
              : logicalText.length;
          const ovStart = Math.max(startCol, lineSelStart);
          const ovEnd = Math.min(endCol, lineSelEndExclusive);
          if (ovStart >= ovEnd) continue;
          const dispStart = visibleWidth(logicalText.slice(startCol, ovStart));
          const dispEnd = visibleWidth(logicalText.slice(startCol, ovEnd)) - 1;
          if (dispEnd < dispStart) continue;
          const rowIdx = firstContentIdx + offsetIdx;
          lines[rowIdx] = highlightLineSelection(
            lines[rowIdx] ?? "",
            pad + dispStart,
            pad + dispEnd,
          );
        }
      }
    }

    if (borderEnabled && borderChars) {
      const vertical = paint(borderChars.vertical);
      const rightPad = " ".repeat(borderRightPad);
      for (let idx = firstContentIdx; idx <= lastContentIdx; idx++) {
        const gutter = idx === firstContentIdx ? promptPrefix : `${vertical} `;
        lines[idx] = gutter + (lines[idx] ?? "") + rightPad + vertical;
      }
    } else if (hasBorderSpace) {
      const rightPad = " ".repeat(borderRightPad);
      for (let idx = firstContentIdx; idx <= lastContentIdx; idx++) {
        const gutter = idx === firstContentIdx ? promptPrefix : indent;
        lines[idx] = `${gutter}${lines[idx] ?? ""}${rightPad} `;
      }
    } else {
      for (let idx = firstContentIdx; idx <= lastContentIdx; idx++) {
        const gutter = idx === firstContentIdx ? promptPrefix : indent;
        const row = gutter + (lines[idx] ?? "");
        lines[idx] =
          width <= promptWidth ? truncateToWidth(row, width, "") : row;
      }
    }
    if (surfaceActive) {
      return lines.map((row) =>
        paintSurfaceLine(row, width, this.modeTheme, surface, colored),
      );
    }
    return lines;
  }
}

function stripCursorMarkers(line: string): string {
  let result = "";
  for (let index = 0; index < line.length; index++) {
    if (line.startsWith("\x1b_pi:", index)) {
      const end = line.indexOf("\x07", index);
      if (end !== -1) {
        index = end;
        continue;
      }
    }
    result += line[index];
  }
  return result;
}

function mapVisualLinesToLogical(
  visualRows: readonly string[],
  logicalLines: readonly string[],
  pad: number,
): Array<{ logicalLine: number; startCol: number; endCol: number }> {
  const result: Array<{
    logicalLine: number;
    startCol: number;
    endCol: number;
  }> = [];
  let logicalLine = 0;
  let offset = 0;

  for (const row of visualRows) {
    if (logicalLine >= logicalLines.length) break;
    const plain = stripTerminalSequences(stripCursorMarkers(row));
    const withoutLeftPad = plain.slice(pad);
    const trimmed = withoutLeftPad.trimEnd();
    const text = logicalLines[logicalLine] ?? "";

    if (text.length === 0) {
      result.push({ logicalLine, startCol: 0, endCol: 0 });
      logicalLine++;
      offset = 0;
      continue;
    }

    let startCol = offset;
    if (
      startCol > 0 &&
      trimmed.length > 0 &&
      !text.startsWith(trimmed, startCol)
    ) {
      while (startCol < text.length && text[startCol] === " ") {
        startCol++;
      }
    }

    const matchLen =
      trimmed.length > 0 && text.startsWith(trimmed, startCol)
        ? trimmed.length
        : Math.min(withoutLeftPad.length, Math.max(0, text.length - startCol));
    const endCol = Math.min(text.length, startCol + matchLen);
    result.push({ logicalLine, startCol, endCol });
    offset = endCol;

    if (offset >= text.length || text.slice(offset).trim().length === 0) {
      logicalLine++;
      offset = 0;
    }
  }

  return result;
}

function printableKey(data: string): string | undefined {
  if (data.length === 1 && data.charCodeAt(0) >= 32) return data;
  const key = parseKey(data);
  if (key === undefined) {
    return data.length > 0 && data[0] !== "\x1b" ? data : undefined;
  }
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

const GRAPHEME_SEGMENTER = new Intl.Segmenter("en", {
  granularity: "grapheme",
});

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

  const flushSelection = () => {
    if (inSelection) {
      result += `\x1b[7m${selectedBuffer}\x1b[27m`;
      selectedBuffer = "";
      inSelection = false;
    }
  };

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

    let textEnd = i;
    while (textEnd < line.length && line.charCodeAt(textEnd) !== 27) {
      textEnd++;
    }
    const textRun = line.slice(i, textEnd);
    i = textEnd;

    for (const { segment: grapheme } of GRAPHEME_SEGMENTER.segment(textRun)) {
      const graphemeWidth = visibleWidth(grapheme);
      const graphemeEndCol = visibleCol + Math.max(0, graphemeWidth - 1);
      const isSelected =
        graphemeWidth > 0
          ? visibleCol <= selEndCol && graphemeEndCol >= selStartCol
          : inSelection;

      if (isSelected) {
        if (!inSelection) {
          inSelection = true;
        }
        selectedBuffer += grapheme;
      } else {
        flushSelection();
        result += grapheme;
      }

      visibleCol += graphemeWidth;
    }
  }

  flushSelection();

  return result;
}
