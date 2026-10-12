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
  it("ships uniform-width art", () => {
    expect(DEFAULT_ART.length).toBeGreaterThan(0);
    for (const line of DEFAULT_ART) {
      expect(visibleWidth(line)).toBe(visibleWidth(DEFAULT_ART[0]));
    }
    expect(defaultConfig().source).toEqual({
      kind: "ascii",
      lines: [...DEFAULT_ART],
    });
  });
});

describe("normalizeConfig", () => {
  it("returns defaults for missing input", () => {
    expect(normalizeConfig(undefined).diagnostics).toEqual([]);
    const { diagnostics } = normalizeConfig(7);
    expect(diagnostics).toHaveLength(1);
  });

  it("validates width and intervalMs", () => {
    const { config, diagnostics } = normalizeConfig({
      width: 80,
      intervalMs: 5000,
    });
    expect(diagnostics).toEqual([]);
    expect(config.width).toBe(80);
    expect(config.intervalMs).toBe(5000);
    for (const bad of [
      { width: 5 },
      { width: 600 },
      { width: 80.5 },
      { width: "x" },
      { intervalMs: 0 },
      { intervalMs: -1 },
      { intervalMs: "x" },
    ]) {
      expect(normalizeConfig(bad).diagnostics).toHaveLength(1);
    }
  });

  it("accepts ascii and command sources", () => {
    const ascii = normalizeConfig({ source: { ascii: ["hi"] } });
    expect(ascii.diagnostics).toEqual([]);
    expect(ascii.config.source).toEqual({ kind: "ascii", lines: ["hi"] });
    const command = normalizeConfig({
      source: { command: "/bin/echo", args: ["hi"] },
    });
    expect(command.diagnostics).toEqual([]);
    expect(command.config.source).toEqual({
      kind: "command",
      command: "/bin/echo",
      args: ["hi"],
    });
  });

  it("prefers command when both sources are given", () => {
    const { config, diagnostics } = normalizeConfig({
      source: { ascii: ["hi"], command: "/bin/echo" },
    });
    expect(config.source).toEqual({
      kind: "command",
      command: "/bin/echo",
      args: [],
    });
    expect(diagnostics).toHaveLength(1);
  });

  it("falls back to the banner on invalid sources", () => {
    for (const source of [
      "nope",
      { command: "" },
      { args: ["hi"] },
      { ascii: "hi" },
      { ascii: [7] },
      {},
    ]) {
      const { config } = normalizeConfig({ source });
      expect(config.source.kind).toBe("ascii");
    }
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
