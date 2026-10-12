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

  it("accepts starship named and indexed colors in separators", () => {
    const { config, diagnostics } = normalizeConfig({
      options: {
        componentSeparator: { text: "|", fg: "bright-red" },
        sectionSeparator: { text: " ", bg: 27 },
      },
    });
    expect(diagnostics).toEqual([]);
    expect(config.options.componentSeparator.fg).toEqual({
      kind: "indexed",
      index: 9,
    });
    expect(config.options.sectionSeparator.bg).toEqual({
      kind: "indexed",
      index: 27,
    });
  });

  it("enables allowlisted extension components", () => {
    const { config, diagnostics } = normalizeConfig({
      extensions: ["mode-guard"],
      sections: { a: [{ type: "mode-guard", fg: "green" }] },
    });
    expect(diagnostics).toEqual([]);
    expect(config.extensions).toEqual(["mode-guard"]);
    expect(config.sections.a).toEqual([
      { type: "mode-guard", fg: { kind: "indexed", index: 2 } },
    ]);
  });

  it("drops extension types missing from the allowlist", () => {
    const { config, diagnostics } = normalizeConfig({
      sections: { a: [{ type: "mystery" }] },
    });
    expect(config).toEqual(defaultConfig());
    expect(diagnostics).toHaveLength(2);
  });

  it("rejects a non-array extensions field", () => {
    const { config, diagnostics } = normalizeConfig({ extensions: "nope" });
    expect(config.extensions).toEqual(["mode-guard", "budgets"]);
    expect(diagnostics).toHaveLength(1);
  });

  it("resolves component colors and drops invalid styling", () => {
    const { config, diagnostics } = normalizeConfig({
      sections: {
        a: [{ type: "mode", fg: "green", bold: true }],
        b: [{ type: "cwd", fg: "nope", bg: "selectedBg", bold: "yes" }],
      },
    });
    expect(config.sections.a).toEqual([
      { type: "mode", fg: { kind: "indexed", index: 2 }, bold: true },
    ]);
    expect(config.sections.b).toEqual([{ type: "cwd", bg: "selectedBg" }]);
    expect(diagnostics).toHaveLength(2);
  });

  it("normalizes component pill styling options", () => {
    const { config, diagnostics } = normalizeConfig({
      sections: {
        a: [
          {
            type: "git_branch",
            accent: "bright-cyan",
            icon: "",
            leftCap: "",
            rightCap: "",
            iconFg: "black",
            iconBg: "bright-cyan",
          },
        ],
      },
    });
    expect(diagnostics).toHaveLength(0);
    expect(config.sections.a[0]).toEqual({
      type: "git_branch",
      accent: { kind: "indexed", index: 14 },
      icon: "",
      leftCap: "",
      rightCap: "",
      iconFg: { kind: "indexed", index: 0 },
      iconBg: { kind: "indexed", index: 14 },
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
