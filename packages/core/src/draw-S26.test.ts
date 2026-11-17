import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import { loadModesConfig } from "./config.js";
import { modeNames, registerMode, replaceConfigModes } from "./modes.js";

for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);

function agentDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-core-modes-"));
}

function write(path: string, content: string, seconds: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  const time = new Date(seconds * 1000);
  utimesSync(path, time, time);
}

function withDefaults(defaults: Record<string, string>): string {
  return JSON.stringify({ modes: { candidate: { defaults } } });
}

describe("S26: modes.json validation and config-layer reload", () => {
  it("validates defaults, rejects allow overrides and name collisions, and replaces only config layers", () => {
    const dir = agentDir();
    const diagnostics: string[] = [];
    const path = join(dir, "modes.json");

    write(
      path,
      withDefaults({ read: "allow", search: "allow", edit: "deny" }),
      1_000,
    );
    expect(loadModesConfig(dir, (m) => diagnostics.push(m))).toEqual([]);
    expect(diagnostics.join(" ")).toContain("missing default");

    write(
      path,
      JSON.stringify({
        modes: {
          candidate: {
            defaults: {
              read: "allow",
              search: "allow",
              edit: "deny",
              shell: "deny",
            },
            overrides: [{ tag: "edit", pattern: "docs/**", effect: "allow" }],
          },
        },
      }),
      1_001,
    );
    expect(
      loadModesConfig(dir, (m) => diagnostics.push(m))[0].overrides,
    ).toEqual([]);
    expect(diagnostics.join(" ")).toContain(
      'overrides must be "ask" or "deny"',
    );

    write(
      path,
      JSON.stringify({
        modes: {
          manual: {
            defaults: {
              read: "allow",
              search: "allow",
              edit: "allow",
              shell: "allow",
            },
          },
        },
      }),
      1_002,
    );
    expect(loadModesConfig(dir, (m) => diagnostics.push(m))).toEqual([]);
    expect(diagnostics.join(" ")).toContain("already registered");

    write(
      path,
      withDefaults({
        read: "allow",
        search: "allow",
        edit: "deny",
        shell: "deny",
      }),
      1_003,
    );
    replaceConfigModes(loadModesConfig(dir));
    expect(modeNames()).toContain("candidate");

    write(
      path,
      JSON.stringify({
        modes: {
          replacement: {
            defaults: {
              read: "allow",
              search: "allow",
              edit: "ask",
              shell: "ask",
            },
          },
        },
      }),
      1_004,
    );
    replaceConfigModes(loadModesConfig(dir));
    expect(modeNames()).not.toContain("candidate");
    expect(modeNames()).toContain("replacement");
    expect(modeNames()).toContain("manual");
    replaceConfigModes([]);
  });
});
