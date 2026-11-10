import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { sanitizeTerminalText } from "@hollowheap/core/format";

export const AGENT_CONFIG_FILE_NAME = "agent.json";

export interface AgentGlobalConfig {
  default?: string;
}

export interface AgentConfigResult {
  default?: string;
  diagnostics: string[];
  userConfigPath?: string;
  projectConfigPath?: string;
}

export interface LoadAgentConfigOptions {
  agentDir: string;
  cwd: string;
  trusted: boolean;
}

export function findProjectAgentConfigFile(cwd: string): string | undefined {
  let current = resolve(cwd);
  while (true) {
    const candidate = join(current, ".pi", AGENT_CONFIG_FILE_NAME);
    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Ignore inaccessible candidate paths and keep walking up.
    }
    const parent = join(current, "..");
    if (parent === current) return undefined;
    current = parent;
  }
}

function parseConfigFile(
  filePath: string,
  diagnostics: string[],
): AgentGlobalConfig | undefined {
  if (!existsSync(filePath)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    diagnostics.push(
      `${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    diagnostics.push(`${filePath}: not valid JSON`);
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    diagnostics.push(`${filePath}: must be a JSON object`);
    return undefined;
  }

  const record = parsed as Record<string, unknown>;
  const hasDefault = "default" in record;
  const hasDefaultAgent = "defaultAgent" in record;
  if (!hasDefault && !hasDefaultAgent) {
    return {};
  }

  const rawDefault = hasDefault ? record.default : record.defaultAgent;

  if (rawDefault === null) {
    return { default: undefined };
  }

  if (typeof rawDefault !== "string") {
    diagnostics.push(`${filePath}: "default" must be a string`);
    return {};
  }
  const cleanDefault = sanitizeTerminalText(rawDefault).trim();
  return { default: cleanDefault !== "" ? cleanDefault : undefined };
}

export function loadAgentConfig(
  options: LoadAgentConfigOptions,
): AgentConfigResult {
  const diagnostics: string[] = [];
  const userConfigPath = join(options.agentDir, AGENT_CONFIG_FILE_NAME);
  const userConfig = parseConfigFile(userConfigPath, diagnostics);

  const projectConfigPath = findProjectAgentConfigFile(options.cwd);
  let projectConfig: AgentGlobalConfig | undefined;

  if (projectConfigPath !== undefined) {
    if (options.trusted) {
      projectConfig = parseConfigFile(projectConfigPath, diagnostics);
    } else {
      diagnostics.push(`ignoring ${projectConfigPath}: project is not trusted`);
    }
  }

  let effectiveDefault = userConfig?.default;
  if (projectConfig !== undefined && "default" in projectConfig) {
    effectiveDefault = projectConfig.default;
  }

  return {
    default: effectiveDefault,
    diagnostics,
    ...(existsSync(userConfigPath) ? { userConfigPath } : {}),
    ...(projectConfigPath !== undefined ? { projectConfigPath } : {}),
  };
}
