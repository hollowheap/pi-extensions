import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { enterMode } from "@hollowheap/core/modes";
import { type AgentConfig, discoverAgents } from "./agents.js";
import { showAgentPicker } from "./picker.js";
import { showAgentSwitchPopup } from "./popup.js";

export const ACTIVE_AGENT_TYPE = "hollowheap.agent";

const VALID_THINKING_LEVELS = new Set<string>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function formatModelId(model: unknown): string {
  if (typeof model === "string") return model.trim();
  if (typeof model === "object" && model !== null) {
    const raw = model as { provider?: unknown; id?: unknown };
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const provider =
      typeof raw.provider === "string" ? raw.provider.trim() : "";

    if (!id) return "";
    if (!provider) return id;
    if (id.startsWith(`${provider}/`)) return id;
    return `${provider}/${id}`;
  }
  return "";
}

export function createAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    let activeAgent: AgentConfig | undefined;
    let lastCwd = process.cwd();
    let lastTrusted = false;
    let baseActiveTools: string[] | undefined;

    const captureBaseActiveTools = (): void => {
      if (
        baseActiveTools !== undefined ||
        typeof pi.getActiveTools !== "function"
      ) {
        return;
      }
      const exposures = new Map(
        pi.getAllTools().map((tool) => [tool.name, tool.exposure]),
      );
      baseActiveTools = pi.getActiveTools().filter((name) => {
        const exposure = exposures.get(name);
        return (
          exposure === undefined ||
          exposure === "direct" ||
          exposure === "model-only"
        );
      });
    };

    const restoreBaseActiveTools = (piApi: ExtensionAPI): void => {
      captureBaseActiveTools();
      if (
        baseActiveTools !== undefined &&
        typeof piApi.setActiveTools === "function"
      ) {
        piApi.setActiveTools([...baseActiveTools]);
      }
    };
    const syncTitle = (
      ctx: ExtensionCommandContext | ExtensionContext,
    ): void => {
      ctx.ui?.setTitle?.(activeAgent ? `Pi — ${activeAgent.name}` : "Pi");
    };

    const resolveAgentDiscovery = (cwd: string, trusted: boolean) =>
      discoverAgents({
        cwd,
        agentDir: getAgentDir(),
        trusted,
      });

    const applyAgent = async (
      agent: AgentConfig,
      ctx: ExtensionCommandContext | ExtensionContext,
      piApi: ExtensionAPI,
      options: { persist?: boolean; notify?: boolean } = {},
    ): Promise<void> => {
      activeAgent = agent;
      if (options.persist) {
        piApi.appendEntry(ACTIVE_AGENT_TYPE, { name: agent.name });
      }

      ctx.ui?.setStatus?.("agent", agent.name);
      syncTitle(ctx);

      if (agent.mode && ctx.sessionManager) {
        const result = enterMode(ctx.sessionManager, agent.mode);
        const error = result.diagnostic ?? result.veto;
        if (error && options.notify) {
          ctx.ui?.notify?.(`Mode error: ${error}`, "error");
        }
      }

      if (agent.model && typeof ctx.modelRegistry?.getAll === "function") {
        const matched = ctx.modelRegistry.getAll().find((model) => {
          if (formatModelId(model) === agent.model) return true;
          return (
            typeof model === "object" &&
            model !== null &&
            "id" in model &&
            (model as { id?: unknown }).id === agent.model
          );
        });
        if (matched) {
          const ok = await piApi.setModel(matched);
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
          typeof piApi.setThinkingLevel === "function"
        ) {
          piApi.setThinkingLevel(level as ThinkingLevel);
        }
      }

      if (agent.tools?.length) {
        captureBaseActiveTools();
        if (typeof piApi.setActiveTools === "function") {
          piApi.setActiveTools(agent.tools);
        }
      } else {
        restoreBaseActiveTools(piApi);
      }

      if (options.notify) {
        ctx.ui?.notify?.(`Switched to agent "${agent.name}"`, "info");
      }
    };

    const applyDefault = async (
      ctx: ExtensionCommandContext | ExtensionContext,
      piApi: ExtensionAPI,
      options: { persist?: boolean; notify?: boolean } = {},
    ): Promise<void> => {
      const previousAgent = activeAgent;
      activeAgent = undefined;
      if (options.persist) {
        piApi.appendEntry(ACTIVE_AGENT_TYPE, { name: null });
      }

      ctx.ui?.setStatus?.("agent", undefined);
      syncTitle(ctx);

      if (options.persist && previousAgent?.mode && ctx.sessionManager) {
        enterMode(ctx.sessionManager, "ask");
      }

      restoreBaseActiveTools(piApi);

      if (options.notify) {
        ctx.ui?.notify?.("Reset to default agent", "info");
      }
    };

    const switchAndFork = async (
      agent: AgentConfig,
      ctx: ExtensionCommandContext,
    ): Promise<void> => {
      const branch = ctx.sessionManager?.getBranch?.() ?? [];
      const hasHistory = branch.some(
        (entry) =>
          entry.type === "message" &&
          (entry as { message?: { role?: string } }).message?.role === "user",
      );

      const baseName = pi.getSessionName() ?? "session";
      const sessionName = `[${agent.name}] ${baseName.replace(/^\[[^\]]+\]\s*/, "")}`;

      ctx.ui?.setStatus?.("agent", agent.name);

      if (hasHistory && branch.length > 0 && typeof ctx.fork === "function") {
        const lastEntry = branch[branch.length - 1];
        let forkStarted = false;
        try {
          await ctx.fork(lastEntry.id, {
            position: "at",
            withSession: async (forkCtx) => {
              forkStarted = true;
              pi.setSessionName(sessionName);
              if (typeof pi.setLabel === "function") {
                pi.setLabel(lastEntry.id, `agent: ${agent.name}`);
              }
              await applyAgent(agent, forkCtx, pi, {
                persist: true,
                notify: false,
              });
              await showAgentSwitchPopup(agent, forkCtx, {
                sessionName,
                forked: true,
              });
            },
          });
          if (forkStarted) {
            return;
          }
        } catch (error) {
          if (forkStarted) {
            ctx.ui?.notify?.(
              `Agent switch failed after fork: ${error instanceof Error ? error.message : String(error)}`,
              "error",
            );
            return;
          }
          // If forking fails before the replacement session starts, fall back
          // to an in-place switch.
        }
      }

      if (typeof pi.setSessionName === "function") {
        pi.setSessionName(sessionName);
      }
      await applyAgent(agent, ctx, pi, { persist: true, notify: false });
      await showAgentSwitchPopup(agent, ctx, { sessionName, forked: false });
    };

    const restore = async (ctx: ExtensionContext): Promise<void> => {
      lastCwd = ctx.cwd;
      lastTrusted = ctx.isProjectTrusted();

      let persistedName: string | undefined;
      const entries = ctx.sessionManager?.getBranch?.() ?? [];
      for (const entry of entries) {
        if (entry.type === "custom" && entry.customType === ACTIVE_AGENT_TYPE) {
          const data = entry.data as { name?: unknown } | undefined;
          if (typeof data?.name === "string" && data.name.trim() !== "") {
            persistedName = data.name.trim();
          } else if (data?.name === null) {
            persistedName = undefined;
          }
        }
      }

      const discovery = resolveAgentDiscovery(ctx.cwd, ctx.isProjectTrusted());
      for (const d of discovery.diagnostics) {
        ctx.ui?.notify?.(`pi-agent: ${d}`, "warning");
      }
      if (persistedName) {
        const agents = discovery.agents;
        const matched = agents.find(
          (a) => a.name.toLowerCase() === persistedName?.toLowerCase(),
        );
        if (matched) {
          await applyAgent(matched, ctx, pi, { persist: false, notify: false });
          return;
        }
      }

      await applyDefault(ctx, pi, { persist: false, notify: false });
    };

    pi.on("session_start", (_event, ctx) => {
      captureBaseActiveTools();
      return restore(ctx);
    });
    pi.on("session_tree", (_event, ctx) => restore(ctx));
    pi.on("project_trust", (event) => {
      lastCwd = event.cwd;
      lastTrusted = false;
      return { trusted: "undecided" };
    });

    pi.on("before_agent_start", (event, ctx) => {
      if (ctx) {
        lastCwd = ctx.cwd;
        lastTrusted = ctx.isProjectTrusted();
      }
      if (!event.systemPromptOptions) return;

      if (
        activeAgent?.skills &&
        activeAgent.skills.length > 0 &&
        !activeAgent.skills.includes("*") &&
        !activeAgent.skills.includes("all") &&
        Array.isArray(event.systemPromptOptions.skills)
      ) {
        const allowed = new Set(activeAgent.skills.map((s) => s.toLowerCase()));
        event.systemPromptOptions.skills =
          event.systemPromptOptions.skills.filter((skill) =>
            allowed.has(skill.name.toLowerCase()),
          );
      }
    });

    const agentCommand = {
      description:
        "Select or switch active agent (model, mode, thinking, tools, skills)",
      getArgumentCompletions: (prefix: string) => {
        const lower = prefix.trim().toLowerCase();
        const agents = resolveAgentDiscovery(lastCwd, lastTrusted).agents;
        const items = [
          {
            value: "default",
            label: "default",
            description: "Reset to default agent",
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
        const discovery = resolveAgentDiscovery(
          ctx.cwd,
          ctx.isProjectTrusted(),
        );
        for (const d of discovery.diagnostics) {
          ctx.ui?.notify?.(`pi-agent: ${d}`, "warning");
        }
        const agents = discovery.agents;
        const raw = args.trim();

        if (raw !== "") {
          const lower = raw.toLowerCase();
          if (lower === "default" || lower === "reset") {
            await applyDefault(ctx, pi, { persist: true, notify: true });
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
          await switchAndFork(matched, ctx);
          return;
        }

        if (ctx.mode === "tui" && typeof ctx.ui?.custom === "function") {
          const picked = await showAgentPicker(ctx, agents);
          if (picked === undefined) return;
          if (picked === "default") {
            await applyDefault(ctx, pi, { persist: true, notify: true });
            return;
          }
          const chosen = agents.find((agent) => agent.name === picked);
          if (chosen) await switchAndFork(chosen, ctx);
          return;
        }

        if (!ctx.hasUI || typeof ctx.ui?.select !== "function") {
          const names = ["default", ...agents.map((a) => a.name)];
          ctx.ui?.notify?.(`Available agents: ${names.join(", ")}`, "info");
          return;
        }

        const defaultOption = "(default) — Reset to default agent";
        const optionMap = new Map<string, AgentConfig | undefined>();
        optionMap.set(defaultOption, undefined);

        for (const a of agents) {
          const modelPart = a.model ? ` [${a.model}]` : "";
          const skillsPart = a.skills ? ` (skills: ${a.skills.join(",")})` : "";
          const label = `${a.name} — ${a.description}${modelPart}${skillsPart}`;
          optionMap.set(label, a);
        }

        const choice = await ctx.ui.select(
          "Select an agent:",
          Array.from(optionMap.keys()),
        );

        if (!choice || !optionMap.has(choice)) {
          return;
        }

        const chosenAgent = optionMap.get(choice);
        if (chosenAgent) {
          await switchAndFork(chosenAgent, ctx);
        } else {
          await applyDefault(ctx, pi, { persist: true, notify: true });
        }
      },
    };

    pi.registerCommand("agent", agentCommand);
    pi.registerCommand("agents", agentCommand);
  };
}

export default function (pi: ExtensionAPI): void {
  createAgentExtension()(pi);
}
