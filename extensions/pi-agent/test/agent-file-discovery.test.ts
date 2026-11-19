import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverAgents } from "../src/agents.js";

function writeAgent(
  dir: string,
  frontmatter: string,
  body = "Body text.",
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "agent.md"), `---\n${frontmatter}\n---\n${body}\n`);
}

describe("/agent discovery", () => {
  it("parses frontmatter skills, mode, and model effort from agent markdown", () => {
    const base = mkdtempSync(join(tmpdir(), "agent-file-discovery-agent-"));
    const agentDir = join(base, "agent");
    mkdirSync(join(agentDir, "agents"), { recursive: true });
    writeFileSync(
      join(agentDir, "agents", "writer.md"),
      [
        "---",
        "name: writer",
        "description: Draft prose",
        "skills: research, edit",
        "mode: plan",
        "model: p/m:low",
        "---",
        "You are a writer.",
      ].join("\n"),
    );

    const result = discoverAgents({
      cwd: join(base, "project"),
      agentDir,
      trusted: false,
    });
    expect(result.agents[0]).toMatchObject({
      name: "writer",
      skills: ["research", "edit"],
      mode: "plan",
      thinking: "low",
    });
  });

  it("untrusted discovery ignores project agents", () => {
    const base = mkdtempSync(join(tmpdir(), "agent-file-discovery-agent-"));
    const agentDir = join(base, "agent");
    const projectAgents = join(base, "project", ".pi", "agents");
    writeAgent(join(agentDir, "agents"), "name: user\ndescription: User agent");
    writeAgent(projectAgents, "name: user\ndescription: Project agent");

    const result = discoverAgents({
      cwd: join(base, "project"),
      agentDir,
      trusted: false,
    });
    expect(result.agents.map((agent) => agent.source)).toEqual(["user"]);
    expect(result.projectAgentsDir).toBe(projectAgents);
  });

  it("invalid frontmatter produces a diagnostic and skips the file", () => {
    const base = mkdtempSync(join(tmpdir(), "agent-file-discovery-agent-"));
    const agentDir = join(base, "agent");
    writeAgent(
      join(agentDir, "agents"),
      "description: no name field",
      "bad body",
    );
    const good = join(agentDir, "agents", "good.md");
    writeFileSync(
      good,
      "---\nname: good\ndescription: Valid agent\n---\nbody\n",
    );

    const result = discoverAgents({
      cwd: join(base, "project"),
      agentDir,
      trusted: false,
    });
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe("good");
    expect(
      result.diagnostics.some((message) =>
        message.includes('missing or invalid "name"'),
      ),
    ).toBe(true);
  });

  it("a project agent shadows a user agent by name with a diagnostic", () => {
    const base = mkdtempSync(join(tmpdir(), "agent-file-discovery-agent-"));
    const agentDir = join(base, "agent");
    const cwd = join(base, "project");
    writeAgent(
      join(agentDir, "agents"),
      "name: writer\ndescription: User writer\nskills: research",
    );
    writeAgent(
      join(cwd, ".pi", "agents"),
      "name: writer\ndescription: Project writer\nskills: edit",
    );

    const result = discoverAgents({ cwd, agentDir, trusted: true });
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({
      name: "writer",
      source: "project",
      description: "Project writer",
      skills: ["edit"],
    });
    expect(
      result.diagnostics.some((message) =>
        message.includes("shadows user agent"),
      ),
    ).toBe(true);
  });
});
