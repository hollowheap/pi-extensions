import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleSkillInput } from "./skills.js";

const dirs: string[] = [];

function makeSkillFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), `pi-modal-skill-${name}-`));
  dirs.push(dir);
  const filePath = join(dir, "SKILL.md");
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("handleSkillInput", () => {
  it("preserves inline $skill tokens in the prompt body while prepending the skill block", () => {
    const skillPath = makeSkillFile(
      "sample-skill",
      "---\nname: sample-skill\ndescription: test\n---\nFollow sample steps.",
    );
    const pi = {
      getCommands: vi.fn(() => [
        {
          name: "skill:sample-skill",
          source: "skill",
          sourceInfo: { path: skillPath },
        },
      ]),
    };

    const result = handleSkillInput(
      {
        source: "interactive",
        text: "Run $sample-skill on index.ts please",
      } as never,
      pi as never,
    );

    expect(result?.action).toBe("transform");
    if (result?.action !== "transform") {
      throw new Error("expected transform result");
    }
    expect(result.text).toContain('<skill name="sample-skill"');
    expect(result.text).toContain("Follow sample steps.");
    expect(result.text.endsWith("Run $sample-skill on index.ts please")).toBe(
      true,
    );
  });

  it("preserves multiple inline $skill tokens while still stripping standalone leading prefixes", () => {
    const aPath = makeSkillFile("alpha", "Alpha instructions");
    const bPath = makeSkillFile("beta", "Beta instructions");
    const pi = {
      getCommands: vi.fn(() => [
        { name: "skill:alpha", source: "skill", sourceInfo: { path: aPath } },
        { name: "skill:beta", source: "skill", sourceInfo: { path: bPath } },
      ]),
    };

    const inline = handleSkillInput(
      {
        source: "interactive",
        text: "Combine $alpha and $beta",
      } as never,
      pi as never,
    );

    expect(inline?.action).toBe("transform");
    if (inline?.action !== "transform") {
      throw new Error("expected transform result");
    }
    expect(inline.text).toContain("Alpha instructions");
    expect(inline.text).toContain("Beta instructions");
    expect(inline.text.endsWith("Combine $alpha and $beta")).toBe(true);

    const standalone = handleSkillInput(
      {
        source: "interactive",
        text: "$alpha",
      } as never,
      pi as never,
    );
    expect(standalone?.action).toBe("transform");
    if (standalone?.action !== "transform") {
      throw new Error("expected transform result");
    }
    expect(standalone.text.endsWith("</skill>")).toBe(true);
  });
});
