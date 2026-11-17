import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverAgents } from "./agents.js";

function writeAgent(dir: string, name: string, description: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "agent.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`,
  );
}

describe("S99 agent discovery and trust", () => {
  it("loads user agents always and trusted project agents that override by name", () => {
    const base = mkdtempSync(join(tmpdir(), "s99-agents-"));
    const agentDir = join(base, "agent");
    const cwd = join(base, "project");
    writeAgent(join(agentDir, "agents"), "scout", "User scout");
    writeAgent(join(cwd, ".pi", "agents"), "scout", "Project scout");

    const untrusted = discoverAgents({ cwd, agentDir, trusted: false });
    expect(untrusted.agents.map((a) => a.description)).toEqual(["User scout"]);

    const trusted = discoverAgents({ cwd, agentDir, trusted: true });
    expect(trusted.agents).toHaveLength(1);
    expect(trusted.agents[0]).toMatchObject({
      name: "scout",
      description: "Project scout",
      source: "project",
    });
  });
});
