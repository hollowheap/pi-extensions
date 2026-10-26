import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverAgents } from "./agents.js";

function root(): string {
  return mkdtempSync(join(tmpdir(), "pi-subagents-agents-"));
}

function writeAgent(
  dir: string,
  file: string,
  frontmatter: string,
  body = "System prompt",
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), `---\n${frontmatter}\n---\n${body}\n`);
}

describe("discoverAgents", () => {
  it("loads user agents with frontmatter overrides", () => {
    const base = root();
    const agentDir = join(base, "agent");
    writeAgent(
      join(agentDir, "agents"),
      "scout.md",
      "name: scout\ndescription: Fast recon\ntools: read, grep\nmodel: p/m\nthinking: high",
    );

    const result = discoverAgents({
      cwd: join(base, "project"),
      agentDir,
      trusted: false,
    });
    expect(result.agents).toEqual([
      expect.objectContaining({
        name: "scout",
        description: "Fast recon",
        tools: ["read", "grep"],
        model: "p/m",
        thinking: "high",
        source: "user",
        systemPrompt: "System prompt",
      }),
    ]);
    expect(result.projectAgentsDir).toBeUndefined();
  });

  it("ignores project agents in untrusted projects", () => {
    const base = root();
    const agentDir = join(base, "agent");
    const project = join(base, "project");
    writeAgent(
      join(agentDir, "agents"),
      "user.md",
      "name: user\ndescription: User",
    );
    writeAgent(
      join(project, ".pi", "agents"),
      "project.md",
      "name: project\ndescription: Project",
    );

    const result = discoverAgents({
      cwd: project,
      agentDir,
      trusted: false,
    });
    expect(result.agents.map((agent) => agent.name)).toEqual(["user"]);
    expect(result.projectAgentsDir).toBe(join(project, ".pi", "agents"));
  });

  it("loads trusted project agents and lets them override user agents", () => {
    const base = root();
    const agentDir = join(base, "agent");
    const project = join(base, "project");
    writeAgent(
      join(agentDir, "agents"),
      "shared.md",
      "name: shared\ndescription: User",
    );
    writeAgent(
      join(project, ".pi", "agents"),
      "shared.md",
      "name: shared\ndescription: Project",
    );

    const result = discoverAgents({
      cwd: project,
      agentDir,
      trusted: true,
    });
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({
      name: "shared",
      description: "Project",
      source: "project",
    });
  });

  it("finds the nearest project agents directory from a nested cwd", () => {
    const base = root();
    const agentDir = join(base, "agent");
    const project = join(base, "project");
    const nested = join(project, "src", "deep");
    mkdirSync(nested, { recursive: true });
    writeAgent(
      join(project, ".pi", "agents"),
      "project.md",
      "name: p\ndescription: P",
    );

    const result = discoverAgents({ cwd: nested, agentDir, trusted: true });
    expect(result.projectAgentsDir).toBe(join(project, ".pi", "agents"));
    expect(result.agents).toEqual([
      expect.objectContaining({ name: "p", source: "project" }),
    ]);
  });

  it("parses array tools and skips invalid agents", () => {
    const base = root();
    const agentDir = join(base, "agent");
    writeAgent(
      join(agentDir, "agents"),
      "array.md",
      "name: array\ndescription: Array\ntools:\n  - read\n  - grep",
    );
    writeAgent(join(agentDir, "agents"), "bad.md", "name: bad");
    writeAgent(join(agentDir, "agents"), "empty.md", "name: \ndescription: ");

    const result = discoverAgents({
      cwd: join(base, "project"),
      agentDir,
      trusted: false,
    });
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({
      name: "array",
      tools: ["read", "grep"],
    });
  });

  it("honors user and project scopes", () => {
    const base = root();
    const agentDir = join(base, "agent");
    const project = join(base, "project");
    writeAgent(
      join(agentDir, "agents"),
      "user.md",
      "name: user\ndescription: User",
    );
    writeAgent(
      join(project, ".pi", "agents"),
      "project.md",
      "name: project\ndescription: Project",
    );

    const userOnly = discoverAgents({
      cwd: project,
      agentDir,
      trusted: true,
      scope: "user",
    });
    expect(userOnly.agents.map((agent) => agent.name)).toEqual(["user"]);

    const projectOnly = discoverAgents({
      cwd: project,
      agentDir,
      trusted: true,
      scope: "project",
    });
    expect(projectOnly.agents.map((agent) => agent.name)).toEqual(["project"]);
  });
});
