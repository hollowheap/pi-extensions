import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
      systemPrompt: "Scout instructions",
      source: "user",
    });
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
});
