import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type DashboardSection, saveDashboardSettings } from "./config.js";

function seedConfig(sections: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "s179-dashboard-"));
  const path = join(dir, "dashboard.json");
  writeFileSync(path, JSON.stringify({ sections }));
  return { dir, path };
}

describe("S179 dashboard header art preservation", () => {
  it("keeps existing header ascii when the header preset changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "s179-dashboard-"));
    const path = join(dir, "dashboard.json");
    writeFileSync(
      path,
      JSON.stringify({
        sections: [
          {
            type: "header",
            ascii: ["custom1", "custom2"],
            color: "cyan",
            gap: 0,
          },
        ],
      }),
    );

    saveDashboardSettings(dir, { header: "banner", gap: 3 });
    const result = JSON.parse(readFileSync(path, "utf8"));

    expect(result.sections[0]).toEqual({
      type: "header",
      ascii: ["custom1", "custom2"],
      color: "cyan",
      gap: 3,
    });
  });

  it("S179 C02: disabling the header removes only the header section", () => {
    const { dir, path } = seedConfig([
      { type: "header", ascii: ["art"], gap: 0 },
      { type: "terminal", command: "date", args: [], intervalMs: 1000, gap: 0 },
    ]);

    saveDashboardSettings(dir, { header: "none", gap: 2 });
    const result = JSON.parse(readFileSync(path, "utf8"));

    expect(
      result.sections.some(
        (section: { type: string }) => section.type === "header",
      ),
    ).toBe(false);
    expect(result.sections).toEqual([
      { type: "terminal", command: "date", args: [], intervalMs: 1000, gap: 0 },
    ]);
  });

  it("S179 C03: an explicit ordered section list replaces the whole config", () => {
    const { dir, path } = seedConfig([
      { type: "header", ascii: ["art"], gap: 0 },
    ]);
    const sections: DashboardSection[] = [
      { type: "state", gap: 0, enabled: true },
      { type: "actions", gap: 0, enabled: false },
    ];

    saveDashboardSettings(dir, { header: "banner", gap: 9, sections });
    const result = JSON.parse(readFileSync(path, "utf8"));

    expect(result.sections).toEqual(sections);
  });

  it("S179 C04: visibility flags add and remove sections around preserved art", () => {
    const { dir, path } = seedConfig([
      { type: "header", ascii: ["art"], color: "red", gap: 0 },
      { type: "state", gap: 1 },
      { type: "sessions", maxItems: 3, scope: "all", gap: 1 },
      { type: "actions", gap: 0 },
    ]);

    saveDashboardSettings(dir, {
      header: "banner",
      gap: 1,
      showState: false,
      showSessions: true,
      showActions: false,
    });
    const result = JSON.parse(readFileSync(path, "utf8"));

    expect(result.sections).toEqual([
      { type: "header", ascii: ["art"], color: "red", gap: 1 },
      { type: "sessions", maxItems: 3, scope: "all", gap: 1 },
    ]);
  });
});
