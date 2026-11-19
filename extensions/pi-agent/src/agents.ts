import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import {
  type AgentFile,
  type AgentFileOptions,
  discoverAgentFiles,
} from "@hollowheap/core/agent-files";

export type AgentConfig = Omit<AgentFile, "systemPrompt" | "harness">;
export type DiscoverAgentsOptions = Omit<AgentFileOptions, "scope">;

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  projectAgentsDir?: string;
  diagnostics: string[];
}

export function discoverAgents(
  options: DiscoverAgentsOptions,
): AgentDiscoveryResult {
  const { agents, ...result } = discoverAgentFiles(options, parseFrontmatter);
  return {
    ...result,
    agents: agents.map(({ systemPrompt, harness, ...agent }) => agent),
  };
}
