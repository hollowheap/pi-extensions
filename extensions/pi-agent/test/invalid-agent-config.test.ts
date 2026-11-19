import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverAgents } from "../src/agents.js";

describe("agent config validation", () => {
  it("skips invalid agent configs and reports a diagnostic", () => {
    const base = mkdtempSync(join(tmpdir(), "invalid-agent-config-agents-"));
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

  it("an empty agents directory yields no agents or diagnostics", () => {
    const base = mkdtempSync(join(tmpdir(), "invalid-agent-config-empty-"));
    const agentDir = join(base, "agent");
    mkdirSync(join(agentDir, "agents"), { recursive: true });
    const result = discoverAgents({
      cwd: join(base, "project"),
      agentDir,
      trusted: false,
    });
    expect(result.agents).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.projectAgentsDir).toBeUndefined();
  });

  it("wrong-typed mode and model fields are diagnosed", () => {
    const base = mkdtempSync(join(tmpdir(), "invalid-agent-config-types-"));
    const agentDir = join(base, "agent");
    const agents = join(agentDir, "agents");
    mkdirSync(agents, { recursive: true });
    writeFileSync(
      join(agents, "badmode.md"),
      "---\nname: badmode\ndescription: Bad mode\nmode: 42\n---\nbody\n",
    );
    writeFileSync(
      join(agents, "badmodel.md"),
      "---\nname: badmodel\ndescription: Bad model\nmodel: true\n---\nbody\n",
    );
    const result = discoverAgents({
      cwd: join(base, "project"),
      agentDir,
      trusted: false,
    });
    expect(result.agents).toEqual([]);
    expect(result.diagnostics.some((line) => line.includes('"mode"'))).toBe(
      true,
    );
    expect(result.diagnostics.some((line) => line.includes('"model"'))).toBe(
      true,
    );
  });

  it("trusted project agents shadow user agents of the same name", () => {
    const base = mkdtempSync(join(tmpdir(), "invalid-agent-config-shadow-"));
    const agentDir = join(base, "agent");
    const userAgents = join(agentDir, "agents");
    const projectAgents = join(base, "project", ".pi", "agents");
    mkdirSync(userAgents, { recursive: true });
    mkdirSync(projectAgents, { recursive: true });
    const frontmatter = (description: string) =>
      `---\nname: dup\ndescription: ${description}\n---\nbody\n`;
    writeFileSync(join(userAgents, "dup.md"), frontmatter("user copy"));
    writeFileSync(join(projectAgents, "dup.md"), frontmatter("project copy"));

    const options = {
      cwd: join(base, "project"),
      agentDir,
    };
    const untrusted = discoverAgents({ ...options, trusted: false });
    const trusted = discoverAgents({ ...options, trusted: true });
    expect(untrusted.agents[0]?.description).toBe("user copy");
    expect(trusted.agents).toHaveLength(1);
    expect(trusted.agents[0]?.description).toBe("project copy");
    expect(
      trusted.diagnostics.some((line) => line.includes("shadows user agent")),
    ).toBe(true);
  });
});
