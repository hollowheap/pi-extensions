import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ART,
  defaultConfig,
  loadConfig,
  normalizeConfig,
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
    expect(defaultConfig().sections).toEqual([
      { type: "header", ascii: [...DEFAULT_ART], gap: 0 },
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
});
