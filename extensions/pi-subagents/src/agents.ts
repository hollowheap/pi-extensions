import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  thinking?: string;
  systemPrompt: string;
  source: "user" | "project";
  filePath: string;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  projectAgentsDir?: string;
}

export interface DiscoverAgentsOptions {
  cwd: string;
  agentDir: string;
  trusted: boolean;
  scope?: AgentScope;
}

type AgentFrontmatter = {
  name?: unknown;
  description?: unknown;
  tools?: unknown;
  model?: unknown;
  thinking?: unknown;
};

function parseTools(value: unknown): string[] | undefined {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const tools = values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return tools.length > 0 ? tools : undefined;
}

function loadDirectory(dir: string, source: "user" | "project"): AgentConfig[] {
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const agents: AgentConfig[] = [];
  for (const name of entries.sort()) {
    if (!name.endsWith(".md")) continue;
    const filePath = join(dir, name);
    try {
      if (!statSync(filePath).isFile()) continue;
      const content = readFileSync(filePath, "utf8");
      const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);
      if (
        typeof frontmatter.name !== "string" ||
        frontmatter.name.trim() === "" ||
        typeof frontmatter.description !== "string" ||
        frontmatter.description.trim() === ""
      ) {
        continue;
      }
      const tools = parseTools(frontmatter.tools);
      agents.push({
        name: frontmatter.name.trim(),
        description: frontmatter.description.trim(),
        ...(tools ? { tools } : {}),
        ...(typeof frontmatter.model === "string" &&
        frontmatter.model.trim() !== ""
          ? { model: frontmatter.model.trim() }
          : {}),
        ...(typeof frontmatter.thinking === "string" &&
        frontmatter.thinking.trim() !== ""
          ? { thinking: frontmatter.thinking.trim() }
          : {}),
        systemPrompt: body.trim(),
        source,
        filePath,
      });
    } catch {
      // One malformed agent must not hide the rest.
    }
  }
  return agents;
}

function findProjectAgentsDir(cwd: string): string | undefined {
  let current = cwd;
  while (true) {
    const candidate = join(current, ".pi", "agents");
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = join(current, "..");
    if (parent === current) return undefined;
    current = parent;
  }
}

export function discoverAgents(
  options: DiscoverAgentsOptions,
): AgentDiscoveryResult {
  const scope = options.scope ?? "both";
  const projectAgentsDir = findProjectAgentsDir(options.cwd);
  const agents = new Map<string, AgentConfig>();

  if (scope !== "project") {
    for (const agent of loadDirectory(
      join(options.agentDir, "agents"),
      "user",
    )) {
      agents.set(agent.name, agent);
    }
  }
  if (scope !== "user" && options.trusted && projectAgentsDir !== undefined) {
    for (const agent of loadDirectory(projectAgentsDir, "project")) {
      agents.set(agent.name, agent);
    }
  }

  return {
    agents: [...agents.values()],
    ...(projectAgentsDir !== undefined ? { projectAgentsDir } : {}),
  };
}
