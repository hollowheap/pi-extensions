import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { errorMessage, sanitizeTerminalText } from "./format.js";
import { splitModelThinking } from "./model-ref.js";
import { findAncestorMatch } from "./scope.js";

export type AgentFileSource = "user" | "project";
export type AgentFileScope = AgentFileSource | "both";

export interface AgentFile {
  name: string;
  description: string;
  model?: string;
  thinking?: string;
  mode?: string;
  harness?: string;
  tools?: string[];
  skills?: string[];
  agents?: string[];
  systemPrompt: string;
  source: AgentFileSource;
  filePath: string;
}

export interface AgentFileOptions {
  cwd: string;
  agentDir: string;
  trusted: boolean;
  scope?: AgentFileScope;
}

type ParseMarkdown = (content: string) => {
  frontmatter: Record<string, unknown>;
  body: string;
};

function cleanText(value: unknown): string | undefined {
  return typeof value === "string"
    ? sanitizeTerminalText(value).trim() || undefined
    : undefined;
}

function readTextField(
  frontmatter: Record<string, unknown>,
  key: string,
  required: true,
): string;
function readTextField(
  frontmatter: Record<string, unknown>,
  key: string,
): string | undefined;
function readTextField(
  frontmatter: Record<string, unknown>,
  key: string,
  required = false,
): string | undefined {
  const raw = frontmatter[key];
  const value = cleanText(raw);
  if (required && value === undefined) {
    throw new Error(`missing or invalid "${key}" field`);
  }
  if (raw !== undefined && typeof raw !== "string") {
    throw new Error(`"${key}" must be a string`);
  }
  return value;
}

function readList(value: unknown): string[] | undefined {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const cleaned = items
    .map(cleanText)
    .filter((item): item is string => item !== undefined);
  return cleaned.length > 0 ? cleaned : undefined;
}

function readAgentFile(
  filePath: string,
  source: AgentFileSource,
  parseMarkdown: ParseMarkdown,
): AgentFile {
  const { frontmatter, body } = parseMarkdown(readFileSync(filePath, "utf8"));
  const [name, description] = (["name", "description"] as const).map((key) =>
    readTextField(frontmatter, key, true),
  );
  const [modelSpec, thinkingField, mode] = (
    ["model", "thinking", "mode"] as const
  ).map((key) => readTextField(frontmatter, key));
  const { model, thinking: suffix } = splitModelThinking(modelSpec ?? "");
  const thinking = suffix ?? thinkingField;
  const [tools, skills, agents] = (["tools", "skills", "agents"] as const).map(
    (key) => readList(frontmatter[key]),
  );
  const harness = cleanText(frontmatter.harness);
  return {
    name,
    description,
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
    ...(mode ? { mode } : {}),
    ...(harness ? { harness } : {}),
    ...(tools ? { tools } : {}),
    ...(skills ? { skills } : {}),
    ...(agents ? { agents } : {}),
    systemPrompt: body.trim(),
    source,
    filePath,
  };
}

function findProjectAgentsDir(cwd: string): string | undefined {
  return findAncestorMatch(cwd, (dir) => {
    const candidate = join(dir, ".pi", "agents");
    try {
      return statSync(candidate).isDirectory() ? candidate : undefined;
    } catch {
      return undefined;
    }
  });
}

export function discoverAgentFiles(
  { agentDir, cwd, scope = "both", trusted }: AgentFileOptions,
  parseMarkdown: ParseMarkdown,
): { agents: AgentFile[]; diagnostics: string[]; projectAgentsDir?: string } {
  const projectAgentsDir = findProjectAgentsDir(cwd);
  const agents = new Map<string, AgentFile>();
  const diagnostics: string[] = [];
  const directories: [AgentFileSource, string][] = [];
  if (scope !== "project") directories.push(["user", join(agentDir, "agents")]);
  if (scope !== "user" && trusted && projectAgentsDir !== undefined) {
    directories.push(["project", projectAgentsDir]);
  }

  for (const [source, directory] of directories) {
    let files: string[];
    try {
      files = readdirSync(directory).sort();
    } catch {
      continue;
    }
    for (const filename of files) {
      if (!filename.endsWith(".md")) continue;
      const path = join(directory, filename);
      try {
        if (!statSync(path).isFile()) continue;
        const agent = readAgentFile(path, source, parseMarkdown);
        if (agents.has(agent.name)) {
          diagnostics.push(
            `duplicate agent "${agent.name}": ${path} ${source === "project" ? "shadows user agent" : "shadowed"}`,
          );
        }
        agents.set(agent.name, agent);
      } catch (error) {
        diagnostics.push(`${path}: ${errorMessage(error)}`);
      }
    }
  }

  return {
    agents: [...agents.values()],
    diagnostics,
    ...(projectAgentsDir === undefined ? {} : { projectAgentsDir }),
  };
}
