import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { session } from "@hollowheap/core/state";
import { showFuzzyPicker } from "@hollowheap/pi-ui/picker";
import type { AgentConfig } from "./agents.js";

export async function showAgentPicker(
  ctx: ExtensionContext,
  agents: readonly AgentConfig[],
): Promise<string | undefined> {
  return showFuzzyPicker(ctx, {
    title: "Select an agent",
    maxVisible: 7,
    emptyText: "No matching agents",
    items: [
      {
        value: "default",
        label: "(default)",
        description: "Reset to default agent",
        preview: ["Default agent"],
      },
      ...agents.map((agent) => ({
        value: agent.name,
        label: agent.name,
        description: agent.description,
        searchText: `${agent.name} ${agent.description ?? ""} ${agent.model ?? ""}`,
        preview: [
          agent.description ?? agent.name,
          `model: ${agent.model ?? "default"}  mode: ${agent.mode ?? session(ctx.sessionManager).mode}  thinking: ${agent.thinking ?? "default"}`,
          `tools: ${agent.tools?.join(", ") ?? "all"}`,
          `skills: ${agent.skills?.join(", ") ?? "all workspace"}`,
          `source: ${agent.source}`,
        ],
      })),
    ],
  });
}
