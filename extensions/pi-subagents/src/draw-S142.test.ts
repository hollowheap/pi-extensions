import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG_FILE_NAME, loadSubagentsConfig } from "./config.js";

describe("S142 generic harness config", () => {
  it("parses a generic CLI harness from subagents.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "s142-subagents-"));
    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({
        harnesses: {
          claude: {
            command: "claude",
            args: ["-p", "{prompt}"],
            input: "arg",
            env: { ANTHROPIC_MODEL: "sonnet" },
          },
        },
      }),
    );

    const config = loadSubagentsConfig(dir);

    expect(config.harnesses.claude).toEqual({
      command: "claude",
      args: ["-p", "{prompt}"],
      input: "arg",
      env: { ANTHROPIC_MODEL: "sonnet" },
    });
    expect(config.diagnostics).toEqual([]);
  });
});
