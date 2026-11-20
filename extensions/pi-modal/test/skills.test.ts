import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SkillInvocationMessageComponent,
  initTheme,
  parseSkillBlock,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import {
  getActiveTuiConfig,
  resetActiveTuiConfig,
  setActiveTuiConfig,
} from "@hollowheap/tui/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installSkillPanel } from "../src/skill-panel.js";
import { formatSkillBlock, handleSkillInput } from "../src/skills.js";

const dirs: string[] = [];

function makeSkillFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), `pi-modal-skill-${name}-`));
  dirs.push(dir);
  const filePath = join(dir, "SKILL.md");
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

afterEach(() => {
  resetActiveTuiConfig();
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("skill invocation panels", () => {
  it("groups consecutive blocks and keeps their text behind the expand control", () => {
    initTheme("dark");
    const config = getActiveTuiConfig();
    setActiveTuiConfig({
      ...config,
      panel: { ...config.panel, enabled: true, borderStyle: "square" },
    });
    installSkillPanel(() => undefined);
    const alpha = formatSkillBlock(
      "alpha",
      "/skills/alpha/SKILL.md",
      "/skills/alpha",
      "Alpha instructions",
    );
    const beta = formatSkillBlock(
      "beta",
      "/skills/beta/SKILL.md",
      "/skills/beta",
      "Beta instructions",
    );
    const savedMessage = `${alpha}\n\n${beta}\n\nRun the checks.`;
    const block = parseSkillBlock(savedMessage);
    if (!block) throw new Error("Expected Pi to parse the skill block");
    const component = new SkillInvocationMessageComponent(block, undefined, 0);
    const render = () =>
      stripTerminalSequences(component.render(80).join("\n"));

    expect(block.userMessage).toBe("Run the checks.");
    expect(render()).toContain("$alpha $beta");
    expect(render()).toContain("to expand");
    expect(render()).not.toContain("instructions");
    expect(render()).toContain("┌");

    component.setExpanded(true);
    expect(render()).toContain("to collapse");
    expect(render()).toContain("Alpha instructions");
    expect(render()).toContain("Beta instructions");
    expect(parseSkillBlock(savedMessage)?.userMessage).toContain(beta);

    component.setExpanded(false);
    expect(render()).not.toContain("instructions");
  });

  it("places host outputPad inside the border instead of adding outer Box margins", () => {
    initTheme("dark");
    const config = getActiveTuiConfig();
    setActiveTuiConfig({
      ...config,
      panel: {
        ...config.panel,
        enabled: true,
        borderStyle: "square",
        accentStripe: false,
        surface: "transparent",
      },
    });
    installSkillPanel(() => undefined);
    const alpha = formatSkillBlock(
      "alpha",
      "/skills/alpha/SKILL.md",
      "/skills/alpha",
      "Alpha instructions",
    );
    const block = parseSkillBlock(`${alpha}\n\nCheck padding.`);
    if (!block) throw new Error("Expected Pi to parse the skill block");

    const component = new SkillInvocationMessageComponent(block, undefined, 1);
    const lines = component
      .render(40)
      .map((line) => stripTerminalSequences(line));

    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe(`┌${"─".repeat(38)}┐`);
    expect(lines[1]).toBe(`│${" ".repeat(38)}│`);
    expect(lines[2]?.startsWith("│ $alpha (")).toBe(true);
    expect(lines[2]?.endsWith("│")).toBe(true);
    expect(lines[3]).toBe(`│${" ".repeat(38)}│`);
    expect(lines[4]).toBe(`└${"─".repeat(38)}┘`);

    component.setOutputPad(1);
    const afterSetPad = component
      .render(40)
      .map((line) => stripTerminalSequences(line));
    expect(afterSetPad).toHaveLength(5);
    expect(afterSetPad[0]).toBe(`┌${"─".repeat(38)}┐`);
    expect(afterSetPad[2]?.startsWith("│ $alpha (")).toBe(true);
  });
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
    expect(standalone.text.endsWith("\n\n$alpha")).toBe(true);
  });

  it("strips malformed YAML frontmatter without throwing when expanding $skill", () => {
    const skillPath = makeSkillFile(
      "broken-yaml",
      "---\nname: [unclosed\ndescription: : invalid: yaml\n---\nFollow broken-yaml steps.",
    );
    const pi = {
      getCommands: vi.fn(() => [
        {
          name: "skill:broken-yaml",
          source: "skill",
          sourceInfo: { path: skillPath },
        },
      ]),
    };

    const result = handleSkillInput(
      {
        source: "interactive",
        text: "Run $broken-yaml now",
      } as never,
      pi as never,
    );

    expect(result?.action).toBe("transform");
    if (result?.action !== "transform") {
      throw new Error("expected transform result");
    }
    expect(result.text).toContain('<skill name="broken-yaml"');
    expect(result.text).toContain("Follow broken-yaml steps.");
    expect(result.text).not.toContain("name: [unclosed");
  });
});
