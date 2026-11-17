import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverAgents } from "./agents.js";

describe("S132 agent config validation", () => {
  it("skips invalid agent configs and reports a diagnostic", () => {
    const base = mkdtempSync(join(tmpdir(), "s132-agents-"));
    const agentDir = join(base, "agent");
    const agents = join(agentDir, "agents");
    mkdirSync(agents, { recursive: true });
    writeFileSync(
      join(agents, "bad.md"),
      "---\ndescription: Missing a name\n---\nbody\n",
    );
    writeFileSync(
      join(agents, "good.md"),
      "---\nname: good\ndescription: Valid agent\n---\nbody\n",
    );

    const result = discoverAgents({
      cwd: join(base, "project"),
      agentDir,
      trusted: false,
    });
    expect(result.agents.map((a) => a.name)).toEqual(["good"]);
    expect(result.diagnostics.some((line) => line.includes('"name"'))).toBe(
      true,
    );
  });
});
