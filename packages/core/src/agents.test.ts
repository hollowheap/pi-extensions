import { describe, expect, it } from "vitest";
import { formatAgentRosterSection, renderAgentRoster } from "./agents.js";

describe("renderAgentRoster", () => {
  it("renders name, description, and the subagent spawn call", () => {
    expect(
      renderAgentRoster([
        { name: "scout", description: "Fast recon" },
        { name: "researcher", description: "Deep research" },
      ]),
    ).toBe(
      [
        "Available subagents. Spawn one with the `subagent` tool using",
        '{ action: "start", agent: "<name>", task: "<task>" }.',
        "- scout: Fast recon",
        "- researcher: Deep research",
      ].join("\n"),
    );
  });

  it("collapses whitespace and strips control bytes from names and descriptions", () => {
    expect(
      renderAgentRoster([
        { name: "sc\u001b[31mout", description: "Fast\n recon\u0007" },
      ]),
    ).toContain("- scout: Fast recon");
  });

  it("renders nothing for an empty roster", () => {
    expect(renderAgentRoster([])).toBe("");
    expect(formatAgentRosterSection([])).toBe("");
  });
});

describe("formatAgentRosterSection", () => {
  it("wraps the roster in an agents tag for raw prompt strings", () => {
    const section = formatAgentRosterSection([
      { name: "scout", description: "Fast recon" },
    ]);
    expect(section.startsWith("<agents>\n")).toBe(true);
    expect(section.endsWith("\n</agents>")).toBe(true);
    expect(section).toContain("- scout: Fast recon");
  });
});
