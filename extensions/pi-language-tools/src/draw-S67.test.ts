import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from "./config.js";

const pkgRoot = fileURLToPath(new URL("../", import.meta.url));

describe("S67: pi-language-tools README documents the lang tool and config", () => {
  it("covers actions, positions, config schema, and trust gating", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    expect(readme).toContain("lang");
    expect(readme).toContain("1-based");
    expect(readme).toContain("language-tools.json");
    expect(readme).toContain("trusted");
  });

  it("S67 C02: documents built-in servers and that commands are not auto-installed", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    expect(readme).toContain("Built-in servers");
    expect(readme).toContain("typescript-language-server");
    expect(readme).toContain("rust-analyzer");
    expect(readme).toContain("auto-installs a server");
  });

  it("S67 C03: documents validation and runtime failure text", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    expect(readme).toContain("Validation errors");
    expect(readme).toContain("a timeout");
    expect(readme).toContain("server failure");
    expect(readme).toContain("explanatory text");
    expect(readme).toContain("No definitions found.");
  });

  it("S67 C04: documents timeout defaults that match the config constants", () => {
    const readme = readFileSync(`${pkgRoot}README.md`, "utf8");
    expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
    expect(MAX_TIMEOUT_MS).toBe(60_000);
    expect(readme).toContain("timeoutMs");
    expect(readme).toContain("10000");
    expect(readme).toContain("60000");
  });
});
