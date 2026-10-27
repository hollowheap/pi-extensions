import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { enterMode } from "@hollowheap/core";
import { type AgentConfig, discoverAgents } from "./agents.js";
import { formatModelId } from "./swap.js";
import { createSubagentTool } from "./tool.js";

export const ACTIVE_AGENT_TYPE = "hollowheap.subagents.active_agent";

const VALID_THINKING_LEVELS = new Set<string>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export interface SubagentsExtensionDeps {
  getAgentDir?: () => string;
}

export function createSubagentsExtension(
  deps: SubagentsExtensionDeps = {},
): (pi: ExtensionAPI) => void {
  const resolveAgentDir = deps.getAgentDir ?? getAgentDir;

  return (pi: ExtensionAPI): void => {
    if (process.env.PI_ACP) return;

    pi.registerTool(createSubagentTool());

    let activeAgent: AgentConfig | undefined;
    let lastCwd = process.cwd();
    let lastTrusted = false;

    const resolveAgents = (cwd: string, trusted: boolean): AgentConfig[] => {
      return discoverAgents({
        cwd,
        agentDir: resolveAgentDir(),
        trusted,
      }).agents;
    };

    const applyAgent = async (
      agent: AgentConfig,
      ctx: ExtensionCommandContext | ExtensionContext,
      options: { persist?: boolean; notify?: boolean } = {},
    ): Promise<void> => {
      activeAgent = agent;
      if (options.persist) {
        pi.appendEntry(ACTIVE_AGENT_TYPE, { name: agent.name });
      }

      ctx.ui?.setStatus?.("agent", agent.name);

      if (agent.mode && ctx.sessionManager) {
        const result = enterMode(ctx.sessionManager, agent.mode);
        const error = result.diagnostic ?? result.veto;
        if (error && options.notify) {
          ctx.ui?.notify?.(`Mode error: ${error}`, "error");
        }
      }

      if (agent.model && ctx.modelRegistry) {
        const all = ctx.modelRegistry.getAll?.() ?? [];
        const matched = all.find(
          (m: unknown) =>
            formatModelId(m) === agent.model ||
            (m &&
              typeof m === "object" &&
              "id" in m &&
              (m as { id?: unknown }).id === agent.model) ||
            (m &&
              typeof m === "object" &&
              "provider" in m &&
              "id" in m &&
              `${(m as { provider?: unknown }).provider}/${(m as { id?: unknown }).id}` ===
                agent.model),
        );
        if (matched) {
          const ok = await pi.setModel(matched as never);
          if (!ok && options.notify) {
            ctx.ui?.notify?.(
              `Failed to set model to "${agent.model}" (authentication unconfigured)`,
              "warning",
            );
          }
        } else if (options.notify) {
          ctx.ui?.notify?.(
            `Agent model "${agent.model}" not found in model registry`,
            "warning",
          );
        }
      }

      const thinking = agent.thinking ?? agent.effort;
      if (thinking) {
        const level = thinking.toLowerCase();
        if (
          VALID_THINKING_LEVELS.has(level) &&
          typeof pi.setThinkingLevel === "function"
        ) {
          pi.setThinkingLevel(level as ThinkingLevel);
        }
      }

      if (agent.tools && Array.isArray(agent.tools)) {
        if (typeof pi.setActiveTools === "function") {
          pi.setActiveTools(agent.tools);
        }
      } else if (
        typeof pi.getAllTools === "function" &&
        typeof pi.setActiveTools === "function"
      ) {
        pi.setActiveTools(pi.getAllTools().map((t) => t.name));
      }

      if (options.notify) {
        ctx.ui?.notify?.(`Switched to agent "${agent.name}"`, "info");
      }
    };

    const applyDefault = async (
      ctx: ExtensionCommandContext | ExtensionContext,
      options: { persist?: boolean; notify?: boolean } = {},
    ): Promise<void> => {
      activeAgent = undefined;
      if (options.persist) {
        pi.appendEntry(ACTIVE_AGENT_TYPE, { name: undefined });
      }

      ctx.ui?.setStatus?.("agent", undefined);

      if (
        typeof pi.getAllTools === "function" &&
        typeof pi.setActiveTools === "function"
      ) {
        pi.setActiveTools(pi.getAllTools().map((t) => t.name));
      }

      if (options.notify) {
        ctx.ui?.notify?.("Reset to default agent persona", "info");
      }
    };

    const restore = async (ctx: ExtensionContext): Promise<void> => {
      lastCwd = ctx.cwd;
      lastTrusted = ctx.isProjectTrusted();

      let persistedName: string | undefined;
      const entries = ctx.sessionManager?.getBranch?.() ?? [];
      for (const entry of entries) {
        if (entry.type === "custom" && entry.customType === ACTIVE_AGENT_TYPE) {
          const data = entry.data as { name?: string } | undefined;
          persistedName = data?.name;
        }
      }

      if (persistedName) {
        const agents = resolveAgents(ctx.cwd, ctx.isProjectTrusted());
        const matched = agents.find(
          (a) => a.name.toLowerCase() === persistedName?.toLowerCase(),
        );
        if (matched) {
          await applyAgent(matched, ctx, { persist: false, notify: false });
          return;
        }
      }

      await applyDefault(ctx, { persist: false, notify: false });
    };

    pi.on("session_start", (_event, ctx) => restore(ctx));
    pi.on("session_tree", (_event, ctx) => restore(ctx));

    pi.on("before_agent_start", (event) => {
      if (!event.systemPromptOptions) return;
      if (!event.systemPromptOptions.sections) {
        event.systemPromptOptions.sections = {};
      }

      if (activeAgent?.systemPrompt) {
        event.systemPromptOptions.sections.agent_persona =
          activeAgent.systemPrompt;
      } else {
        Reflect.deleteProperty(
          event.systemPromptOptions.sections,
          "agent_persona",
        );
      }
    });

    pi.registerCommand("agent", {
      description:
        "Select or switch the active agent persona (system prompt, model, mode, tools)",
      getArgumentCompletions: (prefix: string) => {
        const lower = prefix.trim().toLowerCase();
        const agents = resolveAgents(lastCwd, lastTrusted);
        const items = [
          {
            value: "default",
            label: "default",
            description: "Reset to default agent persona",
          },
          ...agents.map((a) => ({
            value: a.name,
            label: a.name,
            description: a.description,
          })),
        ];
        return items.filter((item) =>
          item.value.toLowerCase().startsWith(lower),
        );
      },
      handler: async (args: string, ctx: ExtensionCommandContext) => {
        lastCwd = ctx.cwd;
        lastTrusted = ctx.isProjectTrusted();
        const agents = resolveAgents(ctx.cwd, ctx.isProjectTrusted());
        const raw = args.trim();

        if (raw !== "") {
          const lower = raw.toLowerCase();
          if (lower === "default" || lower === "reset") {
            await applyDefault(ctx, { persist: true, notify: true });
            return;
          }
          const matched = agents.find((a) => a.name.toLowerCase() === lower);
          if (!matched) {
            ctx.ui?.notify?.(
              `Unknown agent "${raw}". Available: ${["default", ...agents.map((a) => a.name)].join(", ")}`,
              "error",
            );
            return;
          }
          await applyAgent(matched, ctx, { persist: true, notify: true });
          return;
        }

        if (!ctx.hasUI || typeof ctx.ui?.select !== "function") {
          const names = ["default", ...agents.map((a) => a.name)];
          ctx.ui?.notify?.(`Available agents: ${names.join(", ")}`, "info");
          return;
        }

        const defaultOption = "(default) — Reset to default agent persona";
        const optionMap = new Map<string, AgentConfig | undefined>();
        optionMap.set(defaultOption, undefined);

        for (const a of agents) {
          const modelPart = a.model ? ` [${a.model}]` : "";
          const label = `${a.name} — ${a.description}${modelPart}`;
          optionMap.set(label, a);
        }

        const choice = await ctx.ui.select(
          "Select an agent persona:",
          Array.from(optionMap.keys()),
        );

        if (!choice || !optionMap.has(choice)) {
          return;
        }

        const chosenAgent = optionMap.get(choice);
        if (chosenAgent) {
          await applyAgent(chosenAgent, ctx, { persist: true, notify: true });
        } else {
          await applyDefault(ctx, { persist: true, notify: true });
        }
      },
    });
  };
}

export default function (pi: ExtensionAPI): void {
  createSubagentsExtension()(pi);
}
