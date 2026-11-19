import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardSettings } from "../src/settings.js";
import { loadConfig, saveDashboardSettings } from "../src/settings.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("dashboard section settings", () => {
  it("one ordered list replaces defaults with section options", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "draw-dashboard-sections-"));
    dirs.push(agentDir);
    const wanted = [
      { type: "sessions", enabled: true, maxItems: 3, scope: "all" },
      { type: "state", enabled: false },
      { type: "terminal", enabled: true, command: "date", intervalMs: 5_000 },
    ];

    saveDashboardSettings(agentDir, {
      sections: wanted,
    } as never as DashboardSettings);

    expect(loadConfig(agentDir).config.sections).toEqual(wanted);
  });

  it("a missing settings file yields default sections", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "draw-dashboard-defaults-"));
    dirs.push(agentDir);
    const { config, diagnostics } = loadConfig(agentDir);
    expect(config.sections.length).toBeGreaterThan(0);
    expect(diagnostics).toEqual([]);
  });

  it("invalid JSON falls back to defaults with a diagnostic", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "draw-dashboard-badjson-"));
    dirs.push(agentDir);
    writeFileSync(join(agentDir, "dashboard.json"), "{ not json");
    const { config, diagnostics } = loadConfig(agentDir);
    expect(config.sections.length).toBeGreaterThan(0);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]).toContain("not valid JSON");
  });

  it("section-specific options survive a save/load round trip", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "draw-dashboard-options-"));
    dirs.push(agentDir);
    const sections = [
      { type: "sessions", enabled: true, maxItems: 7, scope: "all" },
      { type: "terminal", enabled: true, command: "date", intervalMs: 2_000 },
    ];
    saveDashboardSettings(agentDir, {
      sections,
    } as never as DashboardSettings);
    const loaded = loadConfig(agentDir).config.sections as Array<
      Record<string, unknown>
    >;
    expect(loaded[0]).toMatchObject({ maxItems: 7, scope: "all" });
    expect(loaded[1]).toMatchObject({ command: "date", intervalMs: 2_000 });
  });
});
