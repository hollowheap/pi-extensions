import { describe, expect, it, vi } from "vitest";
import type { DashboardConfig } from "./config.js";
import { createDashboard } from "./index.js";

describe("dashboard builtin sections", () => {
  it("S208 C01: renders context, skills, and extensions as separate sections", () => {
    const config = {
      width: 90,
      sections: [
        { type: "context", enabled: true, gap: 0 },
        { type: "skills", enabled: true, gap: 0 },
        { type: "extensions", enabled: true, gap: 0 },
      ],
    } as unknown as DashboardConfig;
    const deps = {
      run: vi.fn(async () => ""),
      notify: vi.fn(),
    };

    const rendered = createDashboard(config, deps).lines(90).join("\n");

    for (const heading of ["Context", "Skills", "Extensions"]) {
      expect(rendered).toContain(heading);
    }
  });
});
