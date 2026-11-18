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

  it("S208 C02: disabling a section omits its heading", () => {
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

  it("S208 C03: each enabled section reports its own count and empty state", () => {
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

  it("S208 C04: configured order determines heading order", () => {
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
