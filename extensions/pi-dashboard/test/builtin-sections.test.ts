import { describe, expect, it, vi } from "vitest";
import { createDashboard } from "../src/index.js";
import type { DashboardConfig } from "../src/settings.js";

describe("dashboard builtin sections", () => {
  it("renders context, skills, and extensions as separate sections", () => {
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

  it("disabling a section omits its heading", () => {
    const config = {
      width: 90,
      sections: [
        { type: "context", enabled: true, gap: 0 },
        { type: "skills", enabled: false, gap: 0 },
      ],
    } as unknown as DashboardConfig;
    const rendered = createDashboard(config, {
      run: vi.fn(async () => ""),
      notify: vi.fn(),
    })
      .lines(90)
      .join("\n");
    expect(rendered).toContain("Context");
    expect(rendered).not.toContain("Skills");
  });

  it("each enabled section reports its own count and empty state", () => {
    const config = {
      width: 90,
      sections: [
        { type: "context", enabled: true, gap: 0 },
        { type: "skills", enabled: true, gap: 0 },
      ],
    } as unknown as DashboardConfig;
    const rendered = createDashboard(config, {
      run: vi.fn(async () => ""),
      notify: vi.fn(),
    })
      .lines(90)
      .join("\n");
    expect(rendered.match(/0 · empty/g)).toHaveLength(2);
  });

  it("configured order determines heading order", () => {
    const config = {
      width: 90,
      sections: [
        { type: "extensions", enabled: true, gap: 0 },
        { type: "context", enabled: true, gap: 0 },
      ],
    } as unknown as DashboardConfig;
    const rendered = createDashboard(config, {
      run: vi.fn(async () => ""),
      notify: vi.fn(),
    })
      .lines(90)
      .join("\n");
    expect(rendered.indexOf("Extensions")).toBeLessThan(
      rendered.indexOf("Context"),
    );
  });
});
