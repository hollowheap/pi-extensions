import type { AgentConfig } from "./agents.js";

export const SUBAGENT_DEFINITION_TYPE = "hollowheap.subagent.definition";

export interface SessionAgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  model?: string;
  thinking?: string;
  mode?: string;
  effort?: string;
  harness?: string;
}

export function definitionToAgent(
  definition: SessionAgentDefinition,
): AgentConfig {
  return {
    ...definition,
    source: "session",
  };
}

function trimmed(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function parseTools(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tools = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return tools.length > 0 ? tools : undefined;
}

export function definitionsFromEntries(
  entries: readonly unknown[],
): Map<string, AgentConfig> {
  const agents = new Map<string, AgentConfig>();
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const typed = entry as {
      type?: unknown;
      customType?: unknown;
      data?: unknown;
    };
    if (
      typed.type !== "custom" ||
      typed.customType !== SUBAGENT_DEFINITION_TYPE ||
      typeof typed.data !== "object" ||
      typed.data === null
    ) {
      continue;
    }
    const data = typed.data as Partial<SessionAgentDefinition>;
    const name = trimmed(data.name);
    const description = trimmed(data.description);
    const systemPrompt = trimmed(data.systemPrompt);
    if (
      name === undefined ||
      description === undefined ||
      systemPrompt === undefined
    ) {
      continue;
    }
    const definition: SessionAgentDefinition = {
      name,
      description,
      systemPrompt,
    };
    const tools = parseTools(data.tools);
    if (tools !== undefined) definition.tools = tools;
    for (const key of [
      "model",
      "thinking",
      "mode",
      "effort",
      "harness",
    ] as const) {
      const value = trimmed(data[key]);
      if (value !== undefined) definition[key] = value;
    }
    agents.set(name, definitionToAgent(definition));
  }
  return agents;
}
