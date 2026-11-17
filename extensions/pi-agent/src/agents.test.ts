import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverAgents } from "./agents.js";

let baseDir: string;
let agentDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "pi-agent-agents-test-"));
  agentDir = join(baseDir, "agent");
});

afterEach(() => {
  try {
    rmSync(baseDir, { recursive: true, force: true });
  } catch {}
});

function writeAgent(
  dir: string,
  file: string,
  frontmatter: string,
  body = "Instructions",
) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), `---\n${frontmatter}\n---\n${body}\n`);
}

describe("discoverAgents in pi-agent", () => {
  it("parses model, mode, effort, tools, and skills list", () => {
    writeAgent(
      join(agentDir, "agents"),
      "scout.md",
      "name: scout\ndescription: Recon\nmodel: opencode-go/beam-free\nmode: plan\neffort: low\ntools: read, grep\nskills: author-pr, review",
      "Scout instructions",
    );

    const result = discoverAgents({
      cwd: join(baseDir, "project"),
      agentDir,
      trusted: false,
    });

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({
      name: "scout",
      description: "Recon",
      model: "opencode-go/beam-free",
      mode: "plan",
      effort: "low",
      tools: ["read", "grep"],
      skills: ["author-pr", "review"],
      source: "user",
    });
  });

  it("parses the agents roster from a comma string or a YAML list", () => {
    writeAgent(
      join(agentDir, "agents"),
      "lead.md",
      "name: lead\ndescription: Lead\nagents: scout, researcher, worker",
    );
    writeAgent(
      join(agentDir, "agents"),
      "list.md",
      "name: list\ndescription: List\nagents:\n  - scout\n  - code-reviewer",
    );

    const result = discoverAgents({
      cwd: join(baseDir, "project"),
      agentDir,
      trusted: false,
    });
    const byName = new Map(result.agents.map((a) => [a.name, a]));
    expect(byName.get("lead")?.agents).toEqual([
      "scout",
      "researcher",
      "worker",
    ]);
    expect(byName.get("list")?.agents).toEqual(["scout", "code-reviewer"]);
  });

  it("omits agents when the field is empty or absent", () => {
    writeAgent(
      join(agentDir, "agents"),
      "plain.md",
      "name: plain\ndescription: Plain\nagents: ''",
    );
    const result = discoverAgents({
      cwd: join(baseDir, "project"),
      agentDir,
      trusted: false,
    });
    expect(result.agents[0]?.agents).toBeUndefined();
  });

  it("splits a provider/id:<thinking> model into model and thinking", () => {
    writeAgent(
      join(agentDir, "agents"),
      "deep.md",
      "name: deep\ndescription: Deep\nmodel: opencode-go/deepseek-v4.1-flash:high\neffort: low",
    );

    const result = discoverAgents({
      cwd: join(baseDir, "project"),
      agentDir,
      trusted: false,
    });

    expect(result.agents[0]).toMatchObject({
      model: "opencode-go/deepseek-v4.1-flash",
      thinking: "high",
      effort: "low",
    });
  });

  it("reports unreadable agent files instead of silently skipping them", () => {
    const dir = join(agentDir, "agents");
    mkdirSync(dir, { recursive: true });
    symlinkSync(join(dir, "missing.md"), join(dir, "broken.md"));

    const result = discoverAgents({
      cwd: join(baseDir, "project"),
      agentDir,
      trusted: false,
    });

    expect(result.agents).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toContain("broken.md");
  });

  it("loads trusted project agents overriding user agents", () => {
    writeAgent(
      join(agentDir, "agents"),
      "scout.md",
      "name: scout\ndescription: User scout",
    );
    writeAgent(
      join(baseDir, "project", ".pi", "agents"),
      "scout.md",
      "name: scout\ndescription: Project scout\nskills:\n  - custom-skill",
    );

    const result = discoverAgents({
      cwd: join(baseDir, "project"),
      agentDir,
      trusted: true,
    });

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({
      name: "scout",
      description: "Project scout",
      skills: ["custom-skill"],
      source: "project",
    });
  });

  it("sanitizes terminal escape sequences and control bytes from agent fields", () => {
    writeAgent(
      join(agentDir, "agents"),
      "evil.md",
      "name: sc\u001b]2;pwn\u0007out\ndescription: Re\u001b[31mcon\u001b[0m\u0007\nmodel: opencode-go/\u001b[2Jbeam\nmode: pl\u001b[man\neffort: lo\u0007w",
    );

    const result = discoverAgents({
      cwd: join(baseDir, "project"),
      agentDir,
      trusted: false,
    });

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({
      name: "scout",
      description: "Recon",
      model: "opencode-go/beam",
      mode: "plan",
      effort: "low",
    });
  });

  it("rejects non-string thinking and effort fields with diagnostics", () => {
    writeAgent(
      join(agentDir, "agents"),
      "bad-thinking.md",
      "name: bad-thinking\ndescription: Bad\nthinking:\n  - high",
    );
    writeAgent(
      join(agentDir, "agents"),
      "bad-effort.md",
      "name: bad-effort\ndescription: Bad\neffort:\n  level: high",
    );

    const result = discoverAgents({
      cwd: join(baseDir, "project"),
      agentDir,
      trusted: false,
    });

    expect(result.agents).toHaveLength(0);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"thinking" must be a string'),
        expect.stringContaining('"effort" must be a string'),
      ]),
    );
  });
});
