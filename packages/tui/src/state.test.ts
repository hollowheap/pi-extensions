import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_TUI_CONFIG,
  getTuiConfigPath,
} from "@hollowheap/core/tui-config";
import { afterEach, describe, expect, it } from "vitest";
import {
  getActiveTuiConfig,
  loadAndActivateTuiConfig,
  resetActiveTuiConfig,
  setActiveTuiConfig,
} from "./state.js";

const createdDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-tui-state-test-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  resetActiveTuiConfig();
  for (const dir of createdDirs.splice(0)) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Ignore cleanup chmod error.
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("tui state", () => {
  it("starts from DEFAULT_TUI_CONFIG without reading user agentDir", () => {
    resetActiveTuiConfig();
    expect(getActiveTuiConfig()).toEqual(DEFAULT_TUI_CONFIG);
  });

  it("updates, clones, and resets active TUI config", () => {
    setActiveTuiConfig({
      ...DEFAULT_TUI_CONFIG,
      borderStyle: "double",
      overlaySurface: "card",
      toolBox: {
        ...DEFAULT_TUI_CONFIG.toolBox,
        enabled: true,
        verbPack: "playful",
      },
    });

    const active = getActiveTuiConfig();
    expect(active.borderStyle).toBe("double");
    expect(active.overlaySurface).toBe("card");
    expect(active.toolBox.enabled).toBe(true);
    expect(active.toolBox.verbPack).toBe("playful");

    // Mutating returned object does not mutate store state.
    active.borderStyle = "none";
    expect(getActiveTuiConfig().borderStyle).toBe("double");

    resetActiveTuiConfig();
    expect(getActiveTuiConfig()).toEqual(DEFAULT_TUI_CONFIG);
  });

  it("loads and activates tui.json from agentDir", () => {
    const dir = makeTempDir();
    writeFileSync(
      getTuiConfigPath(dir),
      JSON.stringify({
        borderStyle: "square",
        overlaySurface: "contrast",
      }),
      "utf8",
    );

    const diagnostics: string[] = [];
    const loaded = loadAndActivateTuiConfig(dir, (msg) =>
      diagnostics.push(msg),
    );
    expect(diagnostics).toEqual([]);
    expect(loaded.borderStyle).toBe("square");
    expect(loaded.overlaySurface).toBe("contrast");
    expect(getActiveTuiConfig()).toEqual(loaded);
  });

  it("forwards permission errors as diagnostics and falls back to defaults", () => {
    if (process.getuid?.() === 0) return;
    const dir = makeTempDir();
    const path = getTuiConfigPath(dir);
    writeFileSync(path, JSON.stringify({ borderStyle: "double" }), "utf8");
    chmodSync(path, 0o000);

    try {
      const diagnostics: string[] = [];
      const loaded = loadAndActivateTuiConfig(dir, (msg) =>
        diagnostics.push(msg),
      );
      expect(loaded).toEqual(DEFAULT_TUI_CONFIG);
      expect(diagnostics[0]).toMatch(/EACCES|permission denied/i);
    } finally {
      chmodSync(path, 0o600);
    }
  });
});
