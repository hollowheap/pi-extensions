import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModesConfig } from "../src/config.js";
import { getModeLayer, modeNames, replaceConfigModes } from "../src/modes.js";

function agentDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-core-modes-"));
}

function write(path: string, content: string, seconds: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  const time = new Date(seconds * 1000);
  utimesSync(path, time, time);
}

describe("config modes load from <agentDir>/modes.json", () => {
  it("reads and parses a mode layer from the agent directory", () => {
    const dir = agentDir();
    write(
      join(dir, "modes.json"),
      JSON.stringify({
        modes: {
          readonly: {
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

    const layers = loadModesConfig(dir);
    expect(layers).toHaveLength(1);
    expect(layers[0].name).toBe("readonly");
    expect(layers[0].defaults.edit).toBe("deny");
    expect(layers[0].defaults.external).toBe("allow");
    expect(loadModesConfig(agentDir())).toEqual([]);
  });
});

describe("empty document, invalid JSON and registry consumer", () => {
  it("an empty or malformed modes document yields no layers", () => {
    const dir = agentDir();
    write(join(dir, "modes.json"), JSON.stringify({ modes: {} }), 1_000);
    expect(loadModesConfig(dir)).toEqual([]);

    const other = agentDir();
    const diagnostics: string[] = [];
    write(join(other, "modes.json"), JSON.stringify([]), 1_000);
    expect(
      loadModesConfig(other, (message) => diagnostics.push(message)),
    ).toEqual([]);
    expect(diagnostics.join(" ")).toContain('{"modes": {...}}');
  });

  it("invalid JSON in modes.json is reported and ignored", () => {
    const dir = agentDir();
    const diagnostics: string[] = [];
    write(join(dir, "modes.json"), "{bad", 1_000);
    expect(
      loadModesConfig(dir, (message) => diagnostics.push(message)),
    ).toEqual([]);
    expect(diagnostics.join(" ")).toContain("not valid JSON");
  });

  it("loaded config layers can be registered and looked up", () => {
    const dir = agentDir();
    write(
      join(dir, "modes.json"),
      JSON.stringify({
        modes: {
          readonly: {
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
    replaceConfigModes(loadModesConfig(dir));
    expect(getModeLayer("readonly")?.defaults.edit).toBe("deny");
    expect(modeNames()).toContain("readonly");
    replaceConfigModes([]);
    expect(getModeLayer("readonly")).toBeUndefined();
  });
});
