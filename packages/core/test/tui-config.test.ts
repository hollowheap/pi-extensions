import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TUI_CONFIG,
  getTuiConfigPath,
  loadTuiConfig,
  normalizeTuiConfig,
  updateTuiConfig,
} from "../src/tui-config.js";

const createdDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-tui-config-test-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Ignore cleanup chmod error.
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("tui-config", () => {
  it("returns defaults silently when tui.json is missing", () => {
    const dir = makeTempDir();
    const diagnostics: string[] = [];
    expect(loadTuiConfig(dir, (msg) => diagnostics.push(msg))).toEqual(
      DEFAULT_TUI_CONFIG,
    );
    expect(diagnostics).toEqual([]);
  });

  it("normalizes partial configs and inherits borderStyle into panel when omitted", () => {
    const diagnostics: string[] = [];
    const cfg = normalizeTuiConfig(
      {
        borderStyle: "square",
        overlaySurface: "card",
        panel: {
          enabled: true,
          verbPack: "playful",
          customVerbs: {
            read: { active: "Peeking...", settled: "Peeked" },
          },
        },
      },
      diagnostics,
    );

    expect(diagnostics).toEqual([]);
    expect(cfg).toEqual({
      borderStyle: "square",
      overlaySurface: "card",
      colored: true,
      loadingIndicator: "crush",
      loadingIndicatorColor: "gradient",
      loadingIndicatorFade: true,
      markdownRender: true,
      thinkingVerbosity: "verbose",
      toolVerbosity: "medium",
      modeIndicator: true,
      thinkingAnimate: true,
      shimmerSpeed: "normal",
      verbPack: "playful",
      panel: {
        enabled: true,
        mode: "box",
        borderStyle: "square",
        surface: "transparent",
        accentStripe: true,
        outcomeBadges: true,
        reuseSpinner: true,
        customVerbs: {
          read: { active: "Peeking...", settled: "Peeked" },
        },
      },
    });
  });

  it("warns on invalid enum values and falls back cleanly", () => {
    const diagnostics: string[] = [];
    const cfg = normalizeTuiConfig(
      {
        borderStyle: "zigzag",
        overlaySurface: "neon",
        loadingIndicator: "sparkles",
        thinkingVerbosity: "loud",
        colored: "yes",
        panel: { verbPack: "chaotic" },
      },
      diagnostics,
    );

    expect(cfg.borderStyle).toBe("rounded");
    expect(cfg.overlaySurface).toBe("transparent");
    expect(cfg.loadingIndicator).toBe("crush");
    expect(cfg.thinkingVerbosity).toBe("verbose");
    expect(cfg.colored).toBe(true);
    expect(cfg.verbPack).toBe("standard");
    expect(diagnostics).toHaveLength(6);
  });

  it("supports dotted borderStyle, claude preset, loading indicator color/fade, and shimmerSpeed", () => {
    const diagnostics: string[] = [];
    const cfg = normalizeTuiConfig(
      {
        borderStyle: "dotted",
        loadingIndicator: "claude",
        loadingIndicatorColor: "accent",
        loadingIndicatorFade: false,
        shimmerSpeed: "fast",
      },
      diagnostics,
    );
    expect(diagnostics).toEqual([]);
    expect(cfg.borderStyle).toBe("dotted");
    expect(cfg.panel.borderStyle).toBe("dotted");
    expect(cfg.loadingIndicator).toBe("claude");
    expect(cfg.loadingIndicatorColor).toBe("accent");
    expect(cfg.loadingIndicatorFade).toBe(false);
    expect(cfg.shimmerSpeed).toBe("fast");

    const invalidDiagnostics: string[] = [];
    const fallback = normalizeTuiConfig(
      {
        loadingIndicatorColor: "rainbow",
        loadingIndicatorFade: "yes",
        shimmerSpeed: "ludicrous",
      },
      invalidDiagnostics,
    );
    expect(fallback.loadingIndicatorColor).toBe("gradient");
    expect(fallback.loadingIndicatorFade).toBe(true);
    expect(fallback.shimmerSpeed).toBe("normal");
    expect(invalidDiagnostics).toHaveLength(3);
  });

  it("maps legacy thinkingDisplay values to verbosity", () => {
    expect(
      normalizeTuiConfig({ thinkingDisplay: "one-line" }).thinkingVerbosity,
    ).toBe("minimal");
    expect(
      normalizeTuiConfig({ thinkingDisplay: "default" }).thinkingVerbosity,
    ).toBe("verbose");
  });

  it("updates tui.json atomically and preserves unknown keys", () => {
    const dir = makeTempDir();
    writeFileSync(
      getTuiConfigPath(dir),
      JSON.stringify({ customHostKey: 42 }),
      "utf8",
    );

    const res = updateTuiConfig(dir, (current) => {
      current.borderStyle = "double";
      current.colored = false;
      current.loadingIndicator = "braille";
      current.markdownRender = false;
      current.thinkingVerbosity = "minimal";
      current.thinkingAnimate = false;
      current.panel.enabled = true;
      current.verbPack = "terse";
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.customHostKey).toBe(42);
    }
    const reloaded = loadTuiConfig(dir);
    expect(reloaded.borderStyle).toBe("double");
    expect(reloaded.colored).toBe(false);
    expect(reloaded.loadingIndicator).toBe("braille");
    expect(reloaded.markdownRender).toBe(false);
    expect(reloaded.thinkingVerbosity).toBe("minimal");
    expect(reloaded.thinkingAnimate).toBe(false);
    expect(reloaded.panel.enabled).toBe(true);
    expect(reloaded.verbPack).toBe("terse");
  });

  it("reports OS permission errors clearly on unreadable tui.json", () => {
    if (process.getuid?.() === 0) return;
    const dir = makeTempDir();
    const path = getTuiConfigPath(dir);
    writeFileSync(path, JSON.stringify({ borderStyle: "double" }), "utf8");
    chmodSync(path, 0o000);

    try {
      const diagnostics: string[] = [];
      const cfg = loadTuiConfig(dir, (msg) => diagnostics.push(msg));
      expect(cfg).toEqual(DEFAULT_TUI_CONFIG);
      expect(diagnostics[0]).toMatch(/EACCES|permission denied/i);
    } finally {
      chmodSync(path, 0o600);
    }
  });

  it("diagnoses invalid JSON and non-object JSON in tui.json", () => {
    const dir = makeTempDir();
    const path = getTuiConfigPath(dir);

    writeFileSync(path, "{bad", "utf8");
    const jsonDiagnostics: string[] = [];
    expect(loadTuiConfig(dir, (msg) => jsonDiagnostics.push(msg))).toEqual(
      DEFAULT_TUI_CONFIG,
    );
    expect(jsonDiagnostics[0]).toContain("not valid JSON");

    writeFileSync(path, "[]", "utf8");
    const typeDiagnostics: string[] = [];
    expect(loadTuiConfig(dir, (msg) => typeDiagnostics.push(msg))).toEqual(
      DEFAULT_TUI_CONFIG,
    );
    expect(typeDiagnostics[0]).toContain("must be an object");

    writeFileSync(
      path,
      JSON.stringify({ borderStyle: "zigzag", colored: "yes" }),
      "utf8",
    );
    const normDiagnostics: string[] = [];
    const normalized = loadTuiConfig(dir, (msg) => normDiagnostics.push(msg));
    expect(normalized).toEqual(DEFAULT_TUI_CONFIG);
    expect(normDiagnostics).toHaveLength(2);
  });
});

describe("panel style", () => {
  it("preserves fallback borderStyle for surface styles and keeps legacy styles readable", () => {
    const themed = normalizeTuiConfig({
      borderStyle: "sharp",
      panel: { style: "card", borderStyle: "double", surface: "contrast" },
    });
    expect(themed.panel).toMatchObject({
      style: "card",
      mode: "box",
      borderStyle: "sharp",
      surface: "card",
    });
    for (const style of ["surface", "card"] as const) {
      const cfg = normalizeTuiConfig({
        borderStyle: "rounded",
        panel: { style },
      });
      expect(cfg.panel).toMatchObject({
        style,
        mode: "box",
        borderStyle: "rounded",
        surface: style,
      });
    }
    const diagnostics: string[] = [];
    const legacyContrast = normalizeTuiConfig(
      {
        overlaySurface: "contrast",
        panel: { style: "contrast" },
      },
      diagnostics,
    );
    expect(diagnostics).toEqual([]);
    expect(legacyContrast.overlaySurface).toBe("surface");
    expect(legacyContrast.panel).toMatchObject({
      style: "surface",
      mode: "box",
      surface: "surface",
    });
    const plain = normalizeTuiConfig({
      overlaySurface: "card",
      panel: { style: "dashed" },
    });
    expect(plain.panel).toMatchObject({
      mode: "box",
      borderStyle: "dashed",
      surface: "transparent",
    });
    const legacy = normalizeTuiConfig({
      panel: { mode: "background", borderStyle: "double", surface: "contrast" },
    });
    expect(legacy.panel).toMatchObject({
      mode: "background",
      borderStyle: "double",
      surface: "surface",
    });
  });
});
