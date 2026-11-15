import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ART,
  defaultConfig,
  loadConfig,
  normalizeConfig,
  saveDashboardSettings,
} from "./config.js";

describe("default banner", () => {
  it("ships the pi logo on a uniform block grid", () => {
    expect([...DEFAULT_ART]).toEqual([
      "",
      "██████  ",
      "██  ██  ",
      "████  ██",
      "██    ██",
      "",
    ]);
    const widths = new Set(
      DEFAULT_ART.filter((line) => line !== "").map((line) =>
        visibleWidth(line),
      ),
    );
    expect(widths).toEqual(new Set([8]));
    expect(defaultConfig().autoHide).toBe(true);
    expect(defaultConfig().sections).toEqual([
      { type: "header", ascii: [...DEFAULT_ART], gap: 1 },
      { type: "state", gap: 1 },
      { type: "sessions", maxItems: 5, scope: "cwd", gap: 1 },
      { type: "actions", gap: 0 },
    ]);
  });
});

describe("normalizeConfig", () => {
  it("returns defaults for missing input", () => {
    expect(normalizeConfig(undefined).diagnostics).toEqual([]);
    const { diagnostics } = normalizeConfig(7);
    expect(diagnostics).toHaveLength(1);
  });

  it("validates width", () => {
    const { config, diagnostics } = normalizeConfig({ width: 80 });
    expect(diagnostics).toEqual([]);
    expect(config.width).toBe(80);
    for (const bad of [
      { width: 5 },
      { width: 600 },
      { width: 80.5 },
      { width: "x" },
    ]) {
      expect(normalizeConfig(bad).diagnostics).toHaveLength(1);
    }
  });

  it("silently ignores deprecated version sections", () => {
    const { config, diagnostics } = normalizeConfig({
      sections: [
        { type: "version", gap: 1 },
        { type: "state", gap: 1 },
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(config.sections).toEqual([{ type: "state", gap: 1 }]);
  });

  it("accepts state, sessions, actions, and autoHide", () => {
    const { config, diagnostics } = normalizeConfig({
      autoHide: false,
      sections: [
        { type: "state", align: "center", gap: 1 },
        { type: "sessions", maxItems: 8, scope: "all", gap: 2 },
        { type: "actions", gap: 0 },
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(config.autoHide).toBe(false);
    expect(config.sections).toEqual([
      { type: "state", align: "center", gap: 1 },
      { type: "sessions", maxItems: 8, scope: "all", gap: 2 },
      { type: "actions", gap: 0 },
    ]);

    const bad = normalizeConfig({
      autoHide: "yes",
      sections: [{ type: "sessions", maxItems: 50, scope: "invalid" }],
    });
    expect(bad.diagnostics).toHaveLength(3);
    expect(bad.config.autoHide).toBe(true);
    expect(bad.config.sections).toEqual([
      { type: "sessions", maxItems: 5, scope: "cwd", gap: 0 },
    ]);
  });

  it("accepts header and terminal sections", () => {
    const { config, diagnostics } = normalizeConfig({
      width: 40,
      sections: [
        { type: "header", ascii: ["hi"], gap: 1 },
        {
          type: "terminal",
          command: "/bin/echo",
          args: ["hi"],
          intervalMs: 5000,
        },
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(config.sections).toEqual([
      { type: "header", ascii: ["hi"], gap: 1 },
      {
        type: "terminal",
        command: "/bin/echo",
        args: ["hi"],
        intervalMs: 5000,
        gap: 0,
      },
    ]);
  });

  it("treats typeless sections as headers", () => {
    const { config, diagnostics } = normalizeConfig({ sections: [{}] });
    expect(diagnostics).toEqual([]);
    expect(config.sections).toEqual([
      { type: "header", ascii: [...DEFAULT_ART], gap: 0 },
    ]);
  });

  it("defaults header art and terminal timing", () => {
    const { config, diagnostics } = normalizeConfig({
      sections: [{ type: "header" }, { type: "terminal", command: "x" }],
    });
    expect(diagnostics).toEqual([]);
    expect(config.sections).toEqual([
      { type: "header", ascii: [...DEFAULT_ART], gap: 0 },
      { type: "terminal", command: "x", args: [], intervalMs: 30000, gap: 0 },
    ]);
  });

  it("accepts terminal alignment", () => {
    const { config, diagnostics } = normalizeConfig({
      sections: [{ type: "terminal", command: "x", align: "center" }],
    });
    expect(diagnostics).toEqual([]);
    expect(config.sections).toEqual([
      {
        type: "terminal",
        command: "x",
        args: [],
        intervalMs: 30000,
        align: "center",
        gap: 0,
      },
    ]);

    const invalid = normalizeConfig({
      sections: [{ type: "terminal", command: "x", align: "middle" }],
    });
    expect(invalid.diagnostics).toHaveLength(1);
    expect(invalid.config.sections[0]).not.toHaveProperty("align");
  });

  it("skips invalid sections with diagnostics", () => {
    const { config, diagnostics } = normalizeConfig({
      sections: ["nope", { type: "mystery" }, { type: "terminal" }],
    });
    expect(config.sections).toEqual([]);
    expect(diagnostics).toHaveLength(3);
  });

  it("falls back per field inside sections", () => {
    const { config, diagnostics } = normalizeConfig({
      sections: [
        { type: "header", ascii: "hi", gap: -1 },
        { type: "terminal", command: "x", args: "hi", intervalMs: 0 },
      ],
    });
    expect(config.sections).toEqual([
      { type: "header", ascii: [...DEFAULT_ART], gap: 0 },
      { type: "terminal", command: "x", args: [], intervalMs: 30000, gap: 0 },
    ]);
    expect(diagnostics).toHaveLength(4);
  });

  it("saves header and section toggles while preserving terminal sections", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-dashboard-"));
    writeFileSync(
      join(dir, "dashboard.json"),
      JSON.stringify({
        width: 80,
        sections: [
          { type: "header", ascii: ["custom"], gap: 0 },
          { type: "terminal", command: "echo hi", intervalMs: 5000 },
        ],
      }),
    );

    saveDashboardSettings(dir, {
      header: "banner",
      gap: 1,
      showState: true,
      showSessions: true,
      showActions: false,
      autoHide: false,
    });
    const saved = JSON.parse(
      readFileSync(join(dir, "dashboard.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(saved.autoHide).toBe(false);
    expect(saved.sections).toEqual([
      { type: "header", ascii: ["custom"], gap: 1 },
      { type: "terminal", command: "echo hi", intervalMs: 5000 },
      { type: "state", gap: 1 },
      { type: "sessions", maxItems: 5, scope: "cwd", gap: 1 },
    ]);

    saveDashboardSettings(dir, {
      header: "none",
      gap: 0,
      showState: false,
      showSessions: false,
      showActions: false,
    });
    const hidden = JSON.parse(
      readFileSync(join(dir, "dashboard.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(hidden.sections).toEqual([
      { type: "terminal", command: "echo hi", intervalMs: 5000 },
    ]);
  });

  it("throws when existing config is invalid JSON and leaves the file unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-dashboard-"));
    const path = join(dir, "dashboard.json");
    const broken = "{\ninvalid json";
    writeFileSync(path, broken);

    expect(() =>
      saveDashboardSettings(dir, { header: "banner", gap: 0 }),
    ).toThrow();

    expect(readFileSync(path, "utf8")).toBe(broken);
  });

  it("keeps existing header ascii and other header fields when changing gap", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-dashboard-"));
    const path = join(dir, "dashboard.json");
    writeFileSync(
      path,
      JSON.stringify({
        width: 80,
        sections: [
          {
            type: "header",
            ascii: ["custom1", "custom2"],
            color: "cyan",
            gap: 0,
          },
          { type: "terminal", command: "echo hi", intervalMs: 5000 },
        ],
      }),
    );

    saveDashboardSettings(dir, { header: "banner", gap: 3 });
    const result = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    expect(result.sections).toEqual([
      { type: "header", ascii: ["custom1", "custom2"], color: "cyan", gap: 3 },
      { type: "terminal", command: "echo hi", intervalMs: 5000 },
    ]);
  });

  it("flags stale top-level source keys", () => {
    const { diagnostics } = normalizeConfig({
      source: { ascii: ["hi"] },
      intervalMs: 50,
    });
    expect(diagnostics).toHaveLength(2);
  });
});

describe("loadConfig", () => {
  it("returns defaults when no config file exists", () => {
    const { config, diagnostics } = loadConfig(
      join(tmpdir(), "pi-dashboard-missing"),
    );
    expect(config).toEqual(defaultConfig());
    expect(diagnostics).toEqual([]);
  });

  it("reports invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-dashboard-"));
    writeFileSync(join(dir, "dashboard.json"), "{oops");
    const { diagnostics } = loadConfig(dir);
    expect(diagnostics).toHaveLength(1);
  });

  it("reports non-missing read failures", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-dashboard-"));
    mkdirSync(join(dir, "dashboard.json"));
    const { diagnostics } = loadConfig(dir);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("dashboard.json");
  });

  it("formats OS permission errors on unreadable config files", () => {
    if (process.getuid?.() === 0) return;
    const dir = mkdtempSync(join(tmpdir(), "pi-dashboard-"));
    const path = join(dir, "dashboard.json");
    writeFileSync(path, "{}");
    chmodSync(path, 0o000);
    try {
      const { diagnostics } = loadConfig(dir);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toContain("OS permission denied");
    } finally {
      chmodSync(path, 0o600);
    }
  });
});
