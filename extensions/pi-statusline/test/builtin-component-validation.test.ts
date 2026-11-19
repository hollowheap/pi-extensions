import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../src/settings.js";

describe("builtin component resolution", () => {
  it("drops prototype-inherited component types as unknown", () => {
    const { config, diagnostics } = normalizeConfig({
      sections: {
        a: [
          { type: "__proto__" },
          { type: "constructor" },
          { type: "toString" },
          { type: "mode" },
        ],
      },
    });

    expect(config.sections.a).toEqual([{ type: "mode" }]);
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.join("\n")).toContain('"__proto__"');
  });

  it("a non-object root falls back to defaults with a diagnostic", () => {
    const { config, diagnostics } = normalizeConfig("bad");

    expect(config.sections.a).toEqual([{ type: "mode-guard" }]);
    expect(diagnostics).toEqual([
      "config root must be an object; using defaults",
    ]);
  });

  it("builtin style options are normalized while invalid ones diagnose", () => {
    const { config, diagnostics } = normalizeConfig({
      sections: {
        a: [{ type: "mode", fg: "accent", bold: true, iconSide: "sideways" }],
      },
    });

    expect(config.sections.a).toEqual([
      { type: "mode", fg: "accent", bold: true },
    ]);
    expect(diagnostics.join("\n")).toContain("iconSide");
  });

  it("a declared extension component is accepted as a type", () => {
    const { config, diagnostics } = normalizeConfig({
      extensions: ["custom-ext"],
      sections: { a: [{ type: "custom-ext" }] },
    });

    expect(config.sections.a).toEqual([{ type: "custom-ext" }]);
    expect(diagnostics).toEqual([]);
  });
});
