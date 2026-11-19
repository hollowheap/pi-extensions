import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_MODE_LAYERS } from "../../policy/src/modes.js";
import { loadModesConfig } from "../src/config.js";
import {
  evaluate,
  modeNames,
  registerMode,
  replaceConfigModes,
} from "../src/modes.js";
import { dropSession, setMode } from "../src/state.js";

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

describe("modes.json validation and config-layer reload", () => {
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

describe("name and effect validation plus evaluator consumer", () => {
  it("an empty mode name is rejected with a diagnostic", () => {
    const dir = agentDir();
    const diagnostics: string[] = [];
    write(
      join(dir, "modes.json"),
      JSON.stringify({
        modes: {
          "": {
            defaults: {
              read: "allow",
              search: "allow",
              edit: "deny",
              shell: "deny",
            },
          },
        },
      }),
      1_000,
    );
    expect(
      loadModesConfig(dir, (message) => diagnostics.push(message)),
    ).toEqual([]);
    expect(diagnostics.join(" ")).toContain("name must not be empty");
  });

  it("an invalid default effect is rejected with a diagnostic", () => {
    const dir = agentDir();
    const diagnostics: string[] = [];
    write(
      join(dir, "modes.json"),
      JSON.stringify({
        modes: {
          candidate: {
            defaults: {
              read: "allow",
              search: "allow",
              edit: "maybe",
              shell: "deny",
            },
          },
        },
      }),
      1_000,
    );
    expect(
      loadModesConfig(dir, (message) => diagnostics.push(message)),
    ).toEqual([]);
    expect(diagnostics.join(" ")).toContain('invalid effect for "edit"');
  });

  it("a loaded config layer's defaults drive evaluation", () => {
    const dir = agentDir();
    write(
      join(dir, "modes.json"),
      withDefaults({
        read: "allow",
        search: "allow",
        edit: "deny",
        shell: "deny",
      }),
      1_000,
    );
    replaceConfigModes(loadModesConfig(dir));
    const owner = {};
    setMode(owner, "candidate");
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "edit",
        target: "src/a.ts",
        rules: [],
      }),
    ).toBe("deny");
    expect(
      evaluate({
        owner,
        cwd: "/work",
        tag: "read",
        target: "src/a.ts",
        rules: [],
      }),
    ).toBe("allow");
    dropSession(owner);
    replaceConfigModes([]);
  });
});
