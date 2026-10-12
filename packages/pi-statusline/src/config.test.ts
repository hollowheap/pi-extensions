import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig, loadConfig, normalizeConfig } from "./config.js";

describe("normalizeConfig", () => {
  it("returns defaults for undefined input without diagnostics", () => {
    const { config, diagnostics } = normalizeConfig(undefined);
    expect(config).toEqual(defaultConfig());
    expect(diagnostics).toEqual([]);
  });

  it("flags a non-object root and falls back to defaults", () => {
    const { config, diagnostics } = normalizeConfig("nope");
    expect(config).toEqual(defaultConfig());
    expect(diagnostics).toHaveLength(1);
  });

  it("accepts a minimal two-section config", () => {
    const { config, diagnostics } = normalizeConfig({
      sections: { a: [{ type: "cwd" }], z: [{ type: "clock" }] },
    });
    expect(diagnostics).toEqual([]);
    expect(Object.keys(config.sections).sort()).toEqual(["a", "z"]);
    expect(config.options).toEqual(defaultConfig().options);
  });

  it("keeps component options and applies option overrides", () => {
    const { config, diagnostics } = normalizeConfig({
      options: {
        componentSeparator: "|",
        sectionSeparator: " / ",
        gitIntervalMs: 1000,
      },
      sections: { b: [{ type: "cwd", depth: 2 }] },
    });
    expect(diagnostics).toEqual([]);
    expect(config.options).toEqual({
      componentSeparator: { text: "|" },
      sectionSeparator: { text: " / " },
      gitIntervalMs: 1000,
    });
    expect(config.sections.b).toEqual([{ type: "cwd", depth: 2 }]);
  });

  it("reports bad section keys, non-array sections, malformed entries, and unknown types", () => {
    const { config, diagnostics } = normalizeConfig({
      sections: {
        A: [{ type: "cwd" }],
        ab: [{ type: "cwd" }],
        b: { type: "cwd" },
        c: [{ nope: true }, { type: "bogus" }, { type: "cwd" }],
      },
    });
    expect(diagnostics).toHaveLength(5);
    expect(config.sections.c).toEqual([{ type: "cwd" }]);
  });

  it("falls back to defaults when no usable sections remain", () => {
    const foreign = normalizeConfig({
      sections: { lualine_a: [{ provider: "mode" }] },
    });
    expect(foreign.config).toEqual(defaultConfig());
    expect(foreign.diagnostics).toHaveLength(2);
    const empty = normalizeConfig({ sections: {} });
    expect(empty.config).toEqual(defaultConfig());
    expect(empty.diagnostics).toHaveLength(1);
  });

  it("replaces default sections when sections are configured", () => {
    const { config } = normalizeConfig({
      sections: { m: [{ type: "text", text: "hi" }] },
    });
    expect(Object.keys(config.sections)).toEqual(["m"]);
  });

  it("rejects invalid option values with diagnostics", () => {
    const { config, diagnostics } = normalizeConfig({
      options: { componentSeparator: 7, gitIntervalMs: -1 },
    });
    expect(config.options).toEqual(defaultConfig().options);
    expect(diagnostics).toHaveLength(2);
  });

  it("accepts styled separators with theme colors and hex values", () => {
    const { config, diagnostics } = normalizeConfig({
      options: {
        componentSeparator: { text: "|", fg: "dim", bold: true },
        sectionSeparator: { text: "", bg: "#1a1b26" },
      },
    });
    expect(diagnostics).toEqual([]);
    expect(config.options.componentSeparator).toEqual({
      text: "|",
      fg: "dim",
      bold: true,
    });
    expect(config.options.sectionSeparator.text).toBe("");
    expect(config.options.sectionSeparator.bg).toEqual({
      kind: "rgb",
      r: 26,
      g: 27,
      b: 38,
    });
  });

  it("drops invalid separator styling with diagnostics", () => {
    const { config, diagnostics } = normalizeConfig({
      options: {
        componentSeparator: { text: "|", fg: "nope", bg: "dim", bold: "yes" },
        sectionSeparator: 7,
      },
    });
    expect(config.options.componentSeparator).toEqual({ text: "|" });
    expect(config.options.sectionSeparator).toEqual({ text: "  " });
    expect(diagnostics).toHaveLength(4);
  });
});

describe("loadConfig", () => {
  it("returns defaults when no config file exists", () => {
    const { config, diagnostics } = loadConfig(
      join(tmpdir(), "pi-statusline-missing"),
    );
    expect(config).toEqual(defaultConfig());
    expect(diagnostics).toEqual([]);
  });

  it("loads and normalizes a config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-statusline-"));
    writeFileSync(
      join(dir, "statusline.json"),
      JSON.stringify({ sections: { a: [{ type: "mode" }] } }),
    );
    const { config, diagnostics } = loadConfig(dir);
    expect(diagnostics).toEqual([]);
    expect(Object.keys(config.sections)).toEqual(["a"]);
  });

  it("reports invalid JSON and falls back to defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-statusline-"));
    writeFileSync(join(dir, "statusline.json"), "{oops");
    const { config, diagnostics } = loadConfig(dir);
    expect(config).toEqual(defaultConfig());
    expect(diagnostics).toHaveLength(1);
  });
});
