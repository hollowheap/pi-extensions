import { sanitizeTerminalText } from "./format.js";

export interface RosterAgent {
  name: string;
  description: string;
}

/** Inner text of the `<agents>` section. The host adds the tag when used as a prompt section. */
export function renderAgentRoster(agents: readonly RosterAgent[]): string {
  if (agents.length === 0) return "";
  const lines = agents.map((agent) => {
    const name = sanitizeTerminalText(agent.name).replace(/\s+/g, " ").trim();
    const description = sanitizeTerminalText(agent.description)
      .replace(/\s+/g, " ")
      .trim();
    return `- ${name}: ${description}`;
  });
  return [
    "Available subagents. Spawn one with the `subagent` tool using",
    '{ action: "start", agent: "<name>", task: "<task>" }.',
    ...lines,
  ].join("\n");
}

/** Self-tagged roster for raw prompt strings such as a child's append-system-prompt. */
export function formatAgentRosterSection(
  agents: readonly RosterAgent[],
): string {
  const body = renderAgentRoster(agents);
  return body === "" ? "" : `<agents>\n${body}\n</agents>`;
}

export function resolveAgentName(
  name: string,
  agents: readonly RosterAgent[],
): RosterAgent | undefined {
  const normalized = name.trim().toLowerCase();
  if (normalized === "default" || normalized === "none") return undefined;
  return agents.find((agent) => agent.name.toLowerCase() === normalized);
}
