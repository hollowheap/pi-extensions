import {
  type Component,
  type Focusable,
  isFocusable,
} from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { TabbedContent, formatSelectedLabel } from "../src/tabs.js";

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

  it("renders active tab with inverted fg/bg instead of square brackets and switches tabs on mouse click", () => {
    const tabbed = new TabbedContent([
      makeFocusableTab("One"),
      makeFocusableTab("Two"),
      makeFocusableTab("Three"),
    ]);

    const initial = tabbed.render(40);
    expect(initial[0]).toContain("\x1b[7m One \x1b[27m");
    expect(initial[0]).not.toContain("[One]");

    // " One " is cols 0..4, sep "  " is 5..6, " Two " is cols 7..11
    expect(
      tabbed.handleMouse({
        type: "click",
        button: "left",
        x: 8,
        y: 0,
        screenX: 8,
        screenY: 0,
        width: 40,
        height: 10,
      } as never),
    ).toEqual({ handled: true });
    expect(tabbed.activeIndex).toBe(1);

    const second = tabbed.render(40);
    expect(second[0]).toContain("\x1b[7m Two \x1b[27m");

    // SGR mouse click on " Three " (1-based col/row): " One " (0..4), "  " (5..6), " Two " (7..11), "  " (12..13), " Three " (14..20)
    tabbed.handleInput("\x1b[<0;16;1M");
    expect(tabbed.activeIndex).toBe(2);
  });

  it("formatSelectedLabel formats selected with inverted fg/bg and unselected with padding", () => {
    expect(formatSelectedLabel("Confirm", true)).toBe(
      "\x1b[7m Confirm \x1b[27m",
    );
    expect(formatSelectedLabel("Cancel", false)).toBe(" Cancel ");
    const fakeTheme = {
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      bold: (text: string) => `<b>${text}</b>`,
    };
    expect(formatSelectedLabel("Confirm", true, fakeTheme as never)).toBe(
      "\x1b[7m<b><accent> Confirm </accent></b>\x1b[27m",
    );
    expect(formatSelectedLabel("Cancel", false, fakeTheme as never)).toBe(
      "<muted> Cancel </muted>",
    );
  });
});
