import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardSettings } from "./config.js";
import { loadConfig, saveDashboardSettings } from "./config.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("dashboard section settings", () => {
  it("S209 C01: one ordered list replaces defaults with section options", () => {
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
});
