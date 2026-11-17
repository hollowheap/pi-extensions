import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverAgents } from "./agents.js";

describe("S115 /agent discovery", () => {
  it("parses frontmatter skills, mode, and effort from agent markdown", () => {
    const base = mkdtempSync(join(tmpdir(), "s115-agent-"));
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
        "effort: low",
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
      effort: "low",
    });
  });
});
