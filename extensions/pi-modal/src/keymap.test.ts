import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModalConfig } from "./keymap.js";

describe("loadModalConfig", () => {
  it("returns defaults when file missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "modal-"));
    const cfg = loadModalConfig(dir);
    expect(cfg.enabled).toBe(true);
    expect(cfg.promptChar).toBe("❯");
  });
  it("returns defaults on invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "modal-"));
    writeFileSync(join(dir, "modal.json"), "{not json");
    const diag: string[] = [];
    const cfg = loadModalConfig(dir, (m) => diag.push(m));
    expect(cfg.enabled).toBe(true);
    expect(diag.length).toBeGreaterThan(0);
  });
  it("rejects invalid enabled type", () => {
    const dir = mkdtempSync(join(tmpdir(), "modal-"));
    writeFileSync(join(dir, "modal.json"), JSON.stringify({ enabled: "yes" }));
    const diag: string[] = [];
    const cfg = loadModalConfig(dir, (m) => diag.push(m));
    expect(cfg.enabled).toBe(true);
    expect(diag.some((d) => d.includes("enabled"))).toBe(true);
  });
  it("rejects multi-char promptChar", () => {
    const dir = mkdtempSync(join(tmpdir(), "modal-"));
    writeFileSync(
      join(dir, "modal.json"),
      JSON.stringify({ promptChar: "ab" }),
    );
    const diag: string[] = [];
    const cfg = loadModalConfig(dir, (m) => diag.push(m));
    expect(cfg.promptChar).toBe("❯");
    expect(diag.some((d) => d.includes("promptChar"))).toBe(true);
  });
  it("rejects invalid borderStyle", () => {
    const dir = mkdtempSync(join(tmpdir(), "modal-"));
    writeFileSync(
      join(dir, "modal.json"),
      JSON.stringify({ borderStyle: "fancy" }),
    );
    const diag: string[] = [];
    const cfg = loadModalConfig(dir, (m) => diag.push(m));
    expect(cfg.borderStyle).toBe("rounded");
    expect(diag.some((d) => d.includes("borderStyle"))).toBe(true);
  });
  it("ignores invalid keymap entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "modal-"));
    writeFileSync(
      join(dir, "modal.json"),
      JSON.stringify({ keymaps: { normal: { h: 42, "": "x" } } }),
    );
    const diag: string[] = [];
    const cfg = loadModalConfig(dir, (m) => diag.push(m));
    expect(cfg.keymaps?.normal?.h).toBeUndefined();
    expect(diag.length).toBeGreaterThan(0);
  });
});
