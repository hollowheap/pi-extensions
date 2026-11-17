import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { saveDashboardSettings } from "./config.js";

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
});
