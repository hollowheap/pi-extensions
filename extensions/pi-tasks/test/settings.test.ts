import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONFIG_FILE_NAME,
  loadTasksConfig,
  resolveTasksSandboxOptions,
  saveTasksSettings,
} from "../src/settings.js";

const dirs: string[] = [];
function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-tasks-config-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("pi-tasks config", () => {
  it("returns empty defaults when tasks.json does not exist", () => {
    const dir = makeDir();
    const cfg = loadTasksConfig(dir);
    expect(cfg.sandbox).toBeUndefined();
    expect(cfg.diagnostics).toEqual([]);
    expect(cfg.path).toBe(join(dir, CONFIG_FILE_NAME));
  });

  it("parses boolean and object sandbox configurations", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({ sandbox: true }),
    );
    expect(resolveTasksSandboxOptions(loadTasksConfig(dir).sandbox)).toBe(true);

    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        sandbox: { enabled: true, offline: true, maskPaths: ["/secret"] },
      }),
    );
    expect(resolveTasksSandboxOptions(loadTasksConfig(dir).sandbox)).toEqual({
      offline: true,
      maskPaths: ["/secret"],
    });

    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({ sandbox: { enabled: false, offline: true } }),
    );
    expect(
      resolveTasksSandboxOptions(loadTasksConfig(dir).sandbox),
    ).toBeUndefined();
  });

  it("diagnoses malformed sandbox fields and invalid JSON", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        sandbox: { enabled: "yes", offline: 1, maskPaths: [""] },
      }),
    );
    const cfg = loadTasksConfig(dir);
    expect(cfg.diagnostics).toHaveLength(3);

    writeFileSync(join(dir, CONFIG_FILE_NAME), "{bad");
    expect(loadTasksConfig(dir).diagnostics[0]).toContain("is not valid JSON");
  });

  it("saves sandbox settings while preserving unrelated keys and maskPaths", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        note: "keep",
        sandbox: { enabled: false, maskPaths: ["/private"] },
      }),
    );
    saveTasksSettings(dir, { sandboxEnabled: true, sandboxOffline: true });
    const saved = JSON.parse(
      readFileSync(join(dir, CONFIG_FILE_NAME), "utf8"),
    ) as Record<string, unknown>;
    expect(saved.note).toBe("keep");
    expect(saved.sandbox).toEqual({
      enabled: true,
      offline: true,
      maskPaths: ["/private"],
    });
  });

  it("surfaces OS permission errors clearly on read and write", () => {
    if (process.getuid?.() === 0) return;
    const dir = makeDir();
    const path = join(dir, CONFIG_FILE_NAME);
    writeFileSync(path, "{}");
    chmodSync(path, 0o000);
    try {
      const diagnostics: string[] = [];
      const cfg = loadTasksConfig(dir, (msg) => diagnostics.push(msg));
      expect(cfg.diagnostics).toHaveLength(1);
      expect(cfg.diagnostics[0]).toContain("OS permission denied");
      expect(diagnostics).toEqual(cfg.diagnostics);
      expect(() => saveTasksSettings(dir, { sandboxEnabled: true })).toThrow(
        /OS permission denied/,
      );
    } finally {
      chmodSync(path, 0o600);
    }

    const dirReadErr = makeDir();
    mkdirSync(join(dirReadErr, CONFIG_FILE_NAME));
    expect(loadTasksConfig(dirReadErr).diagnostics[0]).toContain(
      CONFIG_FILE_NAME,
    );
  });
});
