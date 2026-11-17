import { describe, expect, it } from "vitest";
import { normalizeConfig } from "./config.js";

describe("S175 builtin component resolution", () => {
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
});
