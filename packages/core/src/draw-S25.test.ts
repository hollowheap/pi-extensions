import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModesConfig } from "./config.js";

function agentDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-core-modes-"));
}

function write(path: string, content: string, seconds: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  const time = new Date(seconds * 1000);
  utimesSync(path, time, time);
}

describe("S25: config modes load from <agentDir>/modes.json", () => {
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
