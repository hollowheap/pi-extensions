import {
  type Component,
  type Focusable,
  isFocusable,
} from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { TabbedContent } from "../src/tabs.js";

function makeFocusableTab(label: string): {
  label: string;
  content: Component & Focusable;
} {
  return {
    label,
    content: {
      focused: false,
      render: () => [label],
      invalidate: () => {},
    },
  };
}

describe("TabbedContent", () => {
  it("exposes activeIndex and clamps setActiveIndex bounds", () => {
    const tabbed = new TabbedContent([
      makeFocusableTab("One"),
      makeFocusableTab("Two"),
      makeFocusableTab("Three"),
    ]);

    expect(tabbed.activeIndex).toBe(0);
    tabbed.setActiveIndex(2);
    expect(tabbed.activeIndex).toBe(2);
    tabbed.setActiveIndex(99);
    expect(tabbed.activeIndex).toBe(2);
    tabbed.setActiveIndex(-5);
    expect(tabbed.activeIndex).toBe(0);
    tabbed.setActiveIndex(Number.NaN);
    expect(tabbed.activeIndex).toBe(0);
  });

  it("implements Focusable and forwards focus only to the active tab", () => {
    const first = makeFocusableTab("One");
    const second = {
      label: "Plain",
      content: { render: () => ["Plain"], invalidate: () => {} },
    };
    const third = makeFocusableTab("Three");
    const tabbed = new TabbedContent([first, second, third]);

    expect(isFocusable(tabbed)).toBe(true);
    tabbed.focused = true;
    expect(tabbed.focused).toBe(true);
    expect(first.content.focused).toBe(true);
    expect(third.content.focused).toBe(false);

    tabbed.setActiveIndex(2);
    expect(first.content.focused).toBe(false);
    expect(third.content.focused).toBe(true);

    tabbed.handleInput("\t");
    expect(tabbed.activeIndex).toBe(0);
    expect(first.content.focused).toBe(true);
    expect(third.content.focused).toBe(false);

    tabbed.focused = false;
    expect(first.content.focused).toBe(false);
  });
});
