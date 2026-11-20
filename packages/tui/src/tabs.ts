import {
  type Component,
  type Focusable,
  Key,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  isFocusable,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

export interface DialogTab {
  label: string;
  content: Component;
}

interface TabBound {
  index: number;
  row: number;
  startCol: number;
  endCol: number;
}

const ESC = String.fromCharCode(27);
const SGR_LEFT_CLICK_RE = new RegExp(`^${ESC}\\[<0;(\\d+);(\\d+)M$`);

/** Dialog content with keyboard and mouse navigation and independent state in each tab. */
export class TabbedContent implements Component, Focusable {
  private _activeIndex = 0;
  private _focused = false;
  private tabBounds: TabBound[] = [];

  constructor(
    private readonly tabs: readonly DialogTab[],
    private readonly styleLabel: (label: string, active: boolean) => string = (
      label,
    ) => label,
  ) {}

  get activeIndex(): number {
    return this._activeIndex;
  }

  setActiveIndex(index: number): void {
    if (this.tabs.length === 0 || !Number.isFinite(index)) return;
    const clamped = Math.max(
      0,
      Math.min(this.tabs.length - 1, Math.trunc(index)),
    );
    this._activeIndex = clamped;
    this.syncFocus();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.syncFocus();
  }

  private syncFocus(): void {
    for (let index = 0; index < this.tabs.length; index += 1) {
      const content = this.tabs[index]?.content ?? null;
      if (isFocusable(content)) {
        content.focused = this._focused && index === this._activeIndex;
      }
    }
  }

  private hitTestTab(x: number, y: number): number | undefined {
    for (const bound of this.tabBounds) {
      if (bound.row === y && x >= bound.startCol && x < bound.endCol) {
        return bound.index;
      }
    }
    return undefined;
  }

  render(width: number): string[] {
    const content = this.tabs[this._activeIndex]?.content.render(width) ?? [];
    if (this.tabs.length < 2) {
      this.tabBounds = [];
      return content;
    }

    const safeWidth = Math.max(1, width);
    const sep = "  ";
    const sepWidth = sep.length;
    const headerLines: string[] = [];
    const bounds: TabBound[] = [];
    let currentLine = "";
    let currentCol = 0;
    let currentRow = 0;

    for (let index = 0; index < this.tabs.length; index += 1) {
      const tab = this.tabs[index];
      if (!tab) continue;
      const active = index === this._activeIndex;
      const styled = this.styleLabel(
        active ? ` ${tab.label} ` : tab.label,
        active,
      );
      const rendered = truncateToWidth(
        active ? `\x1b[7m${styled}\x1b[27m` : styled,
        safeWidth,
        "",
      );
      const itemWidth = visibleWidth(rendered);

      if (currentCol > 0 && currentCol + sepWidth + itemWidth > safeWidth) {
        headerLines.push(currentLine);
        currentLine = "";
        currentCol = 0;
        currentRow += 1;
      }

      if (currentCol > 0) {
        currentLine += sep;
        currentCol += sepWidth;
      }

      const startCol = currentCol;
      currentLine += rendered;
      currentCol += itemWidth;
      bounds.push({ index, row: currentRow, startCol, endCol: currentCol });
    }
    if (currentLine.length > 0) {
      headerLines.push(currentLine);
    }
    this.tabBounds = bounds;

    return [
      ...headerLines,
      truncateToWidth("Tab / Shift+Tab or click to switch tabs", safeWidth),
      "",
      ...content,
    ];
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (
      this.tabs.length > 1 &&
      event.type === "click" &&
      event.button === "left"
    ) {
      const hit = this.hitTestTab(event.x, event.y);
      if (hit !== undefined) {
        this.setActiveIndex(hit);
        return { handled: true };
      }
    }
    return undefined;
  }

  handleInput(data: string): void {
    if (this.tabs.length > 1) {
      const mouseMatch = SGR_LEFT_CLICK_RE.exec(data);
      if (mouseMatch) {
        const col = Number.parseInt(mouseMatch[1] ?? "0", 10) - 1;
        const row = Number.parseInt(mouseMatch[2] ?? "0", 10) - 1;
        const hit = this.hitTestTab(col, row);
        if (hit !== undefined) {
          this.setActiveIndex(hit);
          return;
        }
      }
      const backward = matchesKey(data, Key.shift("tab"));
      if (backward || matchesKey(data, Key.tab)) {
        const count = this.tabs.length;
        this.setActiveIndex(
          (this._activeIndex + (backward ? -1 : 1) + count) % count,
        );
        return;
      }
    }
    this.tabs[this._activeIndex]?.content.handleInput?.(data);
  }

  invalidate(): void {
    for (const tab of this.tabs) tab.content.invalidate();
  }
}
