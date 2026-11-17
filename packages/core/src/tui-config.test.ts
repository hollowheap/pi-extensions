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
} from "./tui-config.js";

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
      markdownRender: true,
      thinkingVerbosity: "verbose",
      thinkingAnimate: true,
      verbPack: "playful",
      panel: {
        enabled: true,
        borderStyle: "square",
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
});
