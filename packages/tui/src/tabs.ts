import {
  type Component,
  type Focusable,
  Key,
  isFocusable,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export interface DialogTab {
  label: string;
  content: Component;
}

/** Dialog content with keyboard navigation and independent state in each tab. */
export class TabbedContent implements Component, Focusable {
  private _activeIndex = 0;
  private _focused = false;

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

  render(width: number): string[] {
    const content = this.tabs[this._activeIndex]?.content.render(width) ?? [];
    if (this.tabs.length < 2) return content;
    const labels = this.tabs.map((tab, index) => {
      const active = index === this._activeIndex;
      return this.styleLabel(active ? `[${tab.label}]` : tab.label, active);
    });
    return [
      ...wrapTextWithAnsi(labels.join("  "), width),
      truncateToWidth("Tab / Shift+Tab to switch tabs", width),
      "",
      ...content,
    ];
  }

  handleInput(data: string): void {
    if (this.tabs.length > 1) {
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
