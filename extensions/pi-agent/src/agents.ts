import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  skills?: string[];
  model?: string;
  thinking?: string;
  mode?: string;
  effort?: string;
  systemPrompt: string;
  source: "user" | "project";
  filePath: string;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  projectAgentsDir?: string;
  diagnostics: string[];
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
  skills?: unknown;
  model?: unknown;
  thinking?: unknown;
  mode?: unknown;
  effort?: unknown;
};

function parseList(value: unknown): string[] | undefined {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const items = values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function loadDirectory(
  dir: string,
  source: "user" | "project",
  diagnostics: string[],
): AgentConfig[] {
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
        frontmatter.name.trim() === ""
      ) {
        diagnostics.push(`${filePath}: missing or invalid "name" field`);
        continue;
      }
      if (
        typeof frontmatter.description !== "string" ||
        frontmatter.description.trim() === ""
      ) {
        diagnostics.push(`${filePath}: missing or invalid "description" field`);
        continue;
      }
      if (
        frontmatter.mode !== undefined &&
        typeof frontmatter.mode !== "string"
      ) {
        diagnostics.push(`${filePath}: "mode" must be a string`);
        continue;
      }
      if (
        frontmatter.model !== undefined &&
        typeof frontmatter.model !== "string"
      ) {
        diagnostics.push(`${filePath}: "model" must be a string`);
        continue;
      }
      const tools = parseList(frontmatter.tools);
      const skills = parseList(frontmatter.skills);
      agents.push({
        name: frontmatter.name.trim(),
        description: frontmatter.description.trim(),
        ...(tools ? { tools } : {}),
        ...(skills ? { skills } : {}),
        ...(typeof frontmatter.model === "string" &&
        frontmatter.model.trim() !== ""
          ? { model: frontmatter.model.trim() }
          : {}),
        ...(typeof frontmatter.thinking === "string" &&
        frontmatter.thinking.trim() !== ""
          ? { thinking: frontmatter.thinking.trim() }
          : {}),
        ...(typeof frontmatter.mode === "string" &&
        frontmatter.mode.trim() !== ""
          ? { mode: frontmatter.mode.trim() }
          : {}),
        ...(typeof frontmatter.effort === "string" &&
        frontmatter.effort.trim() !== ""
          ? { effort: frontmatter.effort.trim() }
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
  const diagnostics: string[] = [];

  if (scope !== "project") {
    for (const agent of loadDirectory(
      join(options.agentDir, "agents"),
      "user",
      diagnostics,
    )) {
      agents.set(agent.name, agent);
    }
  }
  if (scope !== "user" && options.trusted && projectAgentsDir !== undefined) {
    for (const agent of loadDirectory(
      projectAgentsDir,
      "project",
      diagnostics,
    )) {
      agents.set(agent.name, agent);
    }
  }

  return {
    agents: [...agents.values()],
    ...(projectAgentsDir !== undefined ? { projectAgentsDir } : {}),
    diagnostics,
  };
}
