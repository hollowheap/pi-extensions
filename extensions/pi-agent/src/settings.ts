import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";
import { updateJsonConfig } from "@hollowheap/core/config";
import { errorMessage, sanitizeTerminalText } from "@hollowheap/core/format";
import { findAncestorMatch } from "@hollowheap/core/scope";
import { notify } from "@hollowheap/pi-ui/host";
import { showSettingsDialog } from "@hollowheap/pi-ui/settings";

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
  return findAncestorMatch(cwd, (dir) => {
    const candidate = join(dir, ".pi", AGENT_CONFIG_FILE_NAME);
    try {
      return statSync(candidate).isFile() ? candidate : undefined;
    } catch {
      return undefined;
    }
  });
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
    diagnostics.push(`${filePath}: ${errorMessage(error)}`);
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

export function saveAgentDefault(
  agentDir: string,
  name: string | undefined,
): string {
  const path = join(agentDir, AGENT_CONFIG_FILE_NAME);
  const res = updateJsonConfig(path, (root) => {
    if (name === undefined || name === "") {
      Reflect.deleteProperty(root, "default");
    } else {
      root.default = sanitizeTerminalText(name).trim();
    }
    Reflect.deleteProperty(root, "defaultAgent");
  });
  if (!res.ok) throw new Error(res.error);
  return res.path;
}

const NO_DEFAULT = "(default)";

export interface ShowAgentSettingsOptions {
  agents: readonly { name: string; description?: string }[];
  currentDefault?: string;
  onSave: (name: string | undefined) => void;
}

export async function showAgentSettings(
  ctx: ExtensionContext,
  options: ShowAgentSettingsOptions,
): Promise<boolean> {
  let saved = false;
  let value = options.currentDefault ?? NO_DEFAULT;
  const items: SettingItem[] = [
    {
      id: "defaultAgent",
      label: "Default agent",
      description: "Agent applied automatically at the start of new sessions",
      currentValue: value,
      values: [NO_DEFAULT, ...options.agents.map((agent) => agent.name)],
    },
  ];
  await showSettingsDialog({
    ctx,
    title: "Agent settings",
    items,
    header: () => [`Default: ${value}`, ""],
    onChange: (_id, next) => {
      value = next;
      try {
        options.onSave(value === NO_DEFAULT ? undefined : value);
        saved = true;
      } catch (error) {
        notify(
          ctx,
          `pi-agent: failed to save settings: ${errorMessage(error)}`,
          "error",
        );
      }
    },
  });
  return saved;
}
