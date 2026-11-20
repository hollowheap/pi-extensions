import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isSandboxEnabled,
  isSandboxOffline,
  parseSandboxConfig,
  resolveSandboxOptions,
  saveSandboxConfig,
} from "../src/sandbox-config.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-sandbox-config-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("parseSandboxConfig", () => {
  it("defaults enabled from offline and maskPaths", () => {
    expect(parseSandboxConfig(undefined, [])).toBeUndefined();
    expect(parseSandboxConfig(true, [])).toBe(true);
    expect(parseSandboxConfig({ offline: true }, [])).toEqual({
      enabled: true,
      offline: true,
    });
    expect(parseSandboxConfig({ maskPaths: ["/secret"] }, [])).toEqual({
      enabled: true,
      maskPaths: ["/secret"],
    });
  });

  it("diagnoses malformed fields with the default style", () => {
    const diagnostics: string[] = [];
    const config = parseSandboxConfig(
      { enabled: "yes", offline: 1, maskPaths: [""] },
      diagnostics,
      "agents.scout.sandbox",
    );
    expect(config).toEqual({ enabled: false });
    expect(diagnostics).toEqual([
      '"agents.scout.sandbox.enabled" must be a boolean; ignoring',
      '"agents.scout.sandbox.offline" must be a boolean; ignoring',
      '"agents.scout.sandbox.maskPaths" must be an array of non-empty strings; ignoring',
    ]);
  });

  it("supports a custom diagnostic style", () => {
    const diagnostics: string[] = [];
    parseSandboxConfig(
      "yes",
      diagnostics,
      "sandbox",
      (label, field, expected) =>
        `ignoring ${field === undefined ? label : `${label}.${field}`}: must be ${expected}`,
    );
    expect(diagnostics).toEqual([
      "ignoring sandbox: must be a boolean or object",
    ]);
  });
});

describe("sandbox config accessors", () => {
  it("resolves options only when enabled", () => {
    expect(resolveSandboxOptions(true)).toBe(true);
    expect(resolveSandboxOptions(undefined)).toBeUndefined();
    expect(resolveSandboxOptions(false)).toBeUndefined();
    expect(resolveSandboxOptions({ enabled: false })).toBeUndefined();
    expect(
      resolveSandboxOptions({
        enabled: true,
        offline: true,
        maskPaths: ["/x"],
      }),
    ).toEqual({ offline: true, maskPaths: ["/x"] });
  });

  it("reads enabled and offline flags", () => {
    expect(isSandboxEnabled(true)).toBe(true);
    expect(isSandboxEnabled({ enabled: true })).toBe(true);
    expect(isSandboxEnabled({ enabled: false })).toBe(false);
    expect(isSandboxOffline({ enabled: true, offline: true })).toBe(true);
    expect(isSandboxOffline(true)).toBe(false);
  });
});

describe("saveSandboxConfig", () => {
  it("writes sandbox settings and preserves unrelated root and sandbox keys", () => {
    const dir = tempDir();
    const path = join(dir, "tasks.json");
    writeFileSync(
      path,
      JSON.stringify({
        other: "keep",
        sandbox: { custom: 1, offline: true },
      }),
    );

    const savedPath = saveSandboxConfig(path, {
      sandboxEnabled: true,
      maskPaths: ["/secret"],
    });

    expect(savedPath).toBe(path);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      other: "keep",
      sandbox: {
        custom: 1,
        enabled: true,
        offline: true,
        maskPaths: ["/secret"],
      },
    });

    saveSandboxConfig(path, {
      sandboxEnabled: false,
      sandboxOffline: false,
    });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      other: "keep",
      sandbox: {
        custom: 1,
        enabled: false,
        offline: false,
        maskPaths: ["/secret"],
      },
    });
  });

  it("throws when the target file contains invalid JSON", () => {
    const dir = tempDir();
    const path = join(dir, "bad.json");
    writeFileSync(path, "{bad");
    expect(() => saveSandboxConfig(path, { sandboxEnabled: true })).toThrow(
      /not valid JSON/,
    );
  });
});

describe("sandbox backend and image config", () => {
  it("parses backend and image and carries them into resolved options", () => {
    const diagnostics: string[] = [];
    const parsed = parseSandboxConfig(
      { backend: "podman", image: " node:22-alpine " },
      diagnostics,
    );
    expect(diagnostics).toEqual([]);
    expect(parsed).toEqual({
      enabled: true,
      backend: "podman",
      image: "node:22-alpine",
    });
    expect(resolveSandboxOptions(parsed)).toEqual({
      backend: "podman",
      image: "node:22-alpine",
    });
  });

  it("reports an unknown backend and an empty image", () => {
    const diagnostics: string[] = [];
    const parsed = parseSandboxConfig(
      { enabled: true, backend: "lxc", image: "  " },
      diagnostics,
    );
    expect(parsed).toEqual({ enabled: true });
    expect(diagnostics).toEqual([
      '"sandbox.backend" must be one of auto, bwrap, podman, docker; ignoring',
      '"sandbox.image" must be a non-empty string; ignoring',
    ]);
  });

  it("keeps backend and image when saving sandbox toggles", () => {
    const dir = tempDir();
    const path = join(dir, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({ sandbox: { backend: "docker", image: "img:1" } }),
    );
    saveSandboxConfig(path, { sandboxEnabled: true });
    expect(JSON.parse(readFileSync(path, "utf8")).sandbox).toEqual({
      backend: "docker",
      image: "img:1",
      enabled: true,
    });
  });
});
