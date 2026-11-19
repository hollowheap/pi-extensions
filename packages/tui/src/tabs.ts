import {
  type Component,
  Key,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export interface DialogTab {
  label: string;
  content: Component;
}

/** Dialog content with keyboard navigation and independent state in each tab. */
export class TabbedContent implements Component {
  private activeIndex = 0;

  constructor(
    private readonly tabs: readonly DialogTab[],
    private readonly styleLabel: (label: string, active: boolean) => string = (
      label,
    ) => label,
  ) {}

  render(width: number): string[] {
    const content = this.tabs[this.activeIndex]?.content.render(width) ?? [];
    if (this.tabs.length < 2) return content;
    const labels = this.tabs.map((tab, index) => {
      const active = index === this.activeIndex;
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
        this.activeIndex =
          (this.activeIndex + (backward ? -1 : 1) + count) % count;
        return;
      }
    }
    this.tabs[this.activeIndex]?.content.handleInput?.(data);
  }

  invalidate(): void {
    for (const tab of this.tabs) tab.content.invalidate();
  }
}
