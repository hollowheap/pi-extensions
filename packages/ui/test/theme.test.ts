import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { safeBold, safeFg } from "../src/theme.js";

describe("theme helpers", () => {
  it("applies fg and bold when theme methods exist and colored is true", () => {
    const theme = {
      fg: (token: string, value: string) => `<${token}>${value}</${token}>`,
      bold: (value: string) => `<b>${value}</b>`,
    } as unknown as Theme;

    expect(safeFg(theme, "accent", "hi")).toBe("<accent>hi</accent>");
    expect(safeFg(theme, "accent", "hi", false)).toBe("hi");
    expect(safeBold(theme, "hi")).toBe("<b>hi</b>");
  });

  it("falls back to raw text when theme or methods are missing", () => {
    expect(safeFg(undefined, "accent", "hi")).toBe("hi");
    expect(safeFg({} as Theme, "accent", "hi")).toBe("hi");
    expect(safeBold(undefined, "hi")).toBe("hi");
    expect(safeBold({} as Theme, "hi")).toBe("hi");
  });
});
