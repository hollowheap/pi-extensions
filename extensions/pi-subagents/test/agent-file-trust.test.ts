import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverAgents } from "../src/agents.js";

function writeAgent(dir: string, name: string, description: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "agent.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`,
  );
}

describe("agent discovery and trust", () => {
  it("loads user agents always and trusted project agents that override by name", () => {
    const base = mkdtempSync(join(tmpdir(), "agent-file-trust-agents-"));
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

  it("scope excludes the other side regardless of trust", () => {
    const base = mkdtempSync(join(tmpdir(), "agent-file-trust-agents-"));
    const agentDir = join(base, "agent");
    const cwd = join(base, "project");
    writeAgent(join(agentDir, "agents"), "scout", "User scout");
    writeAgent(join(cwd, ".pi", "agents"), "scout", "Project scout");

    const userOnly = discoverAgents({
      cwd,
      agentDir,
      trusted: true,
      scope: "user",
    });
    expect(userOnly.agents.map((a) => a.source)).toEqual(["user"]);
    const projectOnly = discoverAgents({
      cwd,
      agentDir,
      trusted: true,
      scope: "project",
    });
    expect(projectOnly.agents.map((a) => a.source)).toEqual(["project"]);
  });

  it("a malformed agent file is skipped without hiding valid siblings", () => {
    const base = mkdtempSync(join(tmpdir(), "agent-file-trust-agents-"));
    const agentDir = join(base, "agent");
    const cwd = join(base, "project");
    writeAgent(join(agentDir, "agents"), "scout", "User scout");
    mkdirSync(join(agentDir, "agents"), { recursive: true });
    writeFileSync(
      join(agentDir, "agents", "broken.md"),
      "---\ndescription: no name\n---\nbody\n",
    );

    const result = discoverAgents({ cwd, agentDir, trusted: false });
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe("scout");
  });

  it("project agents are found from a parent of cwd", () => {
    const base = mkdtempSync(join(tmpdir(), "agent-file-trust-agents-"));
    const projectDir = join(base, ".pi", "agents");
    const cwd = join(base, "deep", "nested");
    writeAgent(projectDir, "parent", "Parent scout");

    const result = discoverAgents({
      cwd,
      agentDir: join(base, "agent"),
      trusted: true,
    });
    expect(result.projectAgentsDir).toBe(projectDir);
    expect(result.agents.map((a) => a.description)).toEqual(["Parent scout"]);
  });
});
