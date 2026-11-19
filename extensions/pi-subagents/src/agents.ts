import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import {
  type AgentFile,
  type AgentFileOptions,
  type AgentFileScope,
  discoverAgentFiles,
} from "@hollowheap/core/agent-files";

export type AgentScope = AgentFileScope;
export type DiscoverAgentsOptions = AgentFileOptions;

export interface AgentConfig
  extends Omit<AgentFile, "source" | "filePath" | "skills"> {
  source: "user" | "project" | "session";
  filePath?: string;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  projectAgentsDir?: string;
}

export function discoverAgents(
  options: DiscoverAgentsOptions,
): AgentDiscoveryResult {
  const { agents, projectAgentsDir } = discoverAgentFiles(
    options,
    parseFrontmatter,
  );
  return {
    agents: agents.map(({ skills, ...agent }) => agent),
    ...(projectAgentsDir === undefined ? {} : { projectAgentsDir }),
  };
}
