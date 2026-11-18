import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { renderAgentRoster } from "@hollowheap/core/agents";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { enterMode, registerMode } from "@hollowheap/core/modes";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { readPersistedMode, session } from "@hollowheap/core/state";
import { BUILTIN_MODE_LAYERS } from "@hollowheap/policy";
import { type AgentConfig, discoverAgents } from "./agents.js";
import { loadAgentConfig } from "./config.js";

export const ACTIVE_AGENT_TYPE = "hollowheap.agent";

interface PendingFork {
  agent: AgentConfig;
  sessionName: string;
  labelId: string;
}

const PENDING_FORK = Symbol.for("@hollowheap/pi-agent/pending-fork");

// The slot lives on globalThis so it survives the extension reload that
// ctx.fork performs.
const pendingForkSlot = globalThis as unknown as {
  [PENDING_FORK]?: PendingFork;
};

const VALID_THINKING_LEVELS = new Set<string>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function firstUserMessageText(branch: readonly unknown[]): string | undefined {
  for (const item of branch) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as {
      type?: unknown;
      message?: { role?: unknown; content?: unknown };
    };
    if (entry.type !== "message" || entry.message?.role !== "user") continue;
    const content = entry.message.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter(
                (part): part is { type: "text"; text: string } =>
                  typeof part === "object" &&
                  part !== null &&
                  (part as { type?: unknown }).type === "text" &&
                  typeof (part as { text?: unknown }).text === "string",
              )
              .map((part) => part.text)
              .join(" ")
          : "";
    const cleaned = sanitizeTerminalText(text).replace(/\s+/g, " ").trim();
    if (cleaned !== "") return cleaned.slice(0, 60);
  }
  return undefined;
}

function toAgentEntryData(agent: AgentConfig): {
  name: string;
  description?: string;
  model?: string;
  thinking?: string;
  mode?: string;
  updatedAt: number;
} {
  const data: {
    name: string;
    description?: string;
    model?: string;
    thinking?: string;
    mode?: string;
    updatedAt: number;
  } = {
    name: agent.name,
    updatedAt: Date.now(),
  };
  if (agent.description !== undefined) data.description = agent.description;
  if (agent.model !== undefined) data.model = agent.model;
  const thinking = agent.thinking ?? agent.effort;
  if (thinking !== undefined) data.thinking = thinking;
  if (agent.mode !== undefined) data.mode = agent.mode;
  return data;
}

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

interface OverrideState {
  lastAgentIndex: number;
  lastModelChangeIndex: number;
  lastAgentOverride: boolean;
}

function findOverrideState(entries: readonly unknown[]): OverrideState {
  let lastAgentIndex = -1;
  let lastModelChangeIndex = -1;
  let lastAgentOverride = false;
  entries.forEach((entry, index) => {
    const raw = entry as {
      type?: string;
      customType?: string;
      data?: { modelOverride?: unknown };
    };
    if (
      (raw.type === "custom" && raw.customType === ACTIVE_AGENT_TYPE) ||
      raw.type === ACTIVE_AGENT_TYPE
    ) {
      lastAgentIndex = index;
      lastAgentOverride = raw.data?.modelOverride === true;
    }
    if (raw.type === "model_change") {
      lastModelChangeIndex = index;
    }
  });
  return { lastAgentIndex, lastModelChangeIndex, lastAgentOverride };
}

export function createAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    for (const layer of BUILTIN_MODE_LAYERS) registerMode(layer);
    let activeAgent: AgentConfig | undefined;
    let lastCwd = process.cwd();
    let lastTrusted = false;
    let baseActiveTools: string[] | undefined;

    const filterDirectTools = (
      piApi: ExtensionAPI,
      names: readonly string[],
    ): string[] => {
      const exposures = new Map(
        piApi.getAllTools().map((tool) => [tool.name, tool.exposure]),
      );
      return names.filter((name) => {
        const exposure = exposures.get(name);
        return (
          exposure === undefined ||
          exposure === "direct" ||
          exposure === "model-only"
        );
      });
    };

    const deriveDefaultTools = (piApi: ExtensionAPI): string[] =>
      piApi
        .getAllTools()
        .filter((tool) => {
          const defaultActive = (tool as { defaultActive?: unknown })
            .defaultActive;
          if (defaultActive === false) return false;
          const exposure = tool.exposure;
          return (
            exposure === undefined ||
            exposure === "direct" ||
            exposure === "model-only"
          );
        })
        .map((tool) => tool.name);

    const captureBaseActiveTools = (piApi: ExtensionAPI = pi): void => {
      if (typeof piApi.getActiveTools === "function") {
        baseActiveTools = filterDirectTools(piApi, piApi.getActiveTools());
        return;
      }
      if (typeof piApi.getAllTools === "function") {
        baseActiveTools = deriveDefaultTools(piApi);
      }
    };

    const restoreBaseActiveTools = (piApi: ExtensionAPI): void => {
      if (typeof piApi.setActiveTools !== "function") return;
      const tools =
        baseActiveTools !== undefined
          ? baseActiveTools
          : typeof piApi.getAllTools === "function"
            ? deriveDefaultTools(piApi)
            : [];
      piApi.setActiveTools([...tools]);
    };
    const syncTitle = (
      ctx: ExtensionCommandContext | ExtensionContext,
    ): void => {
      ctx.ui?.setTitle?.(
        activeAgent ? `Pi — ${sanitizeTerminalText(activeAgent.name)}` : "Pi",
      );
    };

    const resolveAgentDiscovery = (cwd: string, trusted: boolean) =>
      discoverAgents({
        cwd,
        agentDir: getAgentDir(),
        trusted,
      });

    const resolveRosterAgent = (
      cwd: string,
      trusted: boolean,
    ): AgentConfig | undefined => {
      if (activeAgent !== undefined) return activeAgent;
      const configured = loadAgentConfig({
        agentDir: getAgentDir(),
        cwd,
        trusted,
      }).default;
      if (configured === undefined) return undefined;
      const lower = configured.toLowerCase();
      if (lower === "default" || lower === "none") return undefined;
      return resolveAgentDiscovery(cwd, trusted).agents.find(
        (candidate) => candidate.name.toLowerCase() === lower,
      );
    };

    const applyAgent = async (
      agent: AgentConfig,
      ctx: ExtensionCommandContext | ExtensionContext,
      piApi: ExtensionAPI,
      options: {
        persist?: boolean;
        notify?: boolean;
        preserveThinking?: boolean;
        preserveMode?: boolean;
      } = {},
    ): Promise<void> => {
      const preservedThinking =
        options.preserveThinking === true &&
        typeof piApi.getThinkingLevel === "function"
          ? piApi.getThinkingLevel()
          : undefined;
      if (activeAgent === undefined && options.persist) {
        captureBaseActiveTools(piApi);
      }
      activeAgent = agent;
      if (options.persist) {
        piApi.appendEntry(ACTIVE_AGENT_TYPE, toAgentEntryData(agent));
      }

      ctx.ui?.setStatus?.("agent", sanitizeTerminalText(agent.name));
      syncTitle(ctx);
      piApi.events?.emit?.("statusline:values", {
        name: "agent",
        text: sanitizeTerminalText(agent.name),
      });

      if (ctx.sessionManager) {
        updateSessionSnapshot(ctx.sessionManager, "agent", {
          name: agent.name,
          description: agent.description,
          model: agent.model,
          ...(preservedThinking !== undefined
            ? { thinking: preservedThinking }
            : { thinking: agent.thinking ?? agent.effort }),
          mode:
            options.preserveMode === true && ctx.sessionManager
              ? session(ctx.sessionManager).mode
              : agent.mode,
          tools: agent.tools,
          skills: agent.skills,
          updatedAt: Date.now(),
        });
      }

      if (agent.mode && ctx.sessionManager && options.preserveMode !== true) {
        const result = enterMode(ctx.sessionManager, agent.mode, {
          persist: false,
        });
        const error = result.diagnostic ?? result.veto;
        if (error && options.notify) {
          ctx.ui?.notify?.(`Mode error: ${error}`, "error");
        }
      }

      const hasModelOverride = (): boolean => {
        if (options.persist) return false;
        const entries =
          (typeof ctx.sessionManager?.getBranch === "function"
            ? ctx.sessionManager.getBranch()
            : []) ?? [];
        const { lastAgentIndex, lastModelChangeIndex, lastAgentOverride } =
          findOverrideState(entries);
        return lastAgentOverride || lastModelChangeIndex > lastAgentIndex;
      };
      const skipModel = hasModelOverride();

      if (
        agent.model &&
        !skipModel &&
        typeof ctx.modelRegistry?.getAll === "function"
      ) {
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
          const currentModelId = formatModelId(ctx.model);
          const targetModelId = formatModelId(matched);
          // Re-setting the same model resets thinking to the model or global
          // default, discarding the level restored from the session.
          const alreadyActive =
            currentModelId !== "" && currentModelId === targetModelId;
          if (!alreadyActive) {
            const ok = await piApi.setModel(matched);
            if (!ok) {
              ctx.ui?.notify?.(
                `Failed to set model to "${agent.model}" (authentication unconfigured)`,
                "warning",
              );
            }
          }
        } else {
          ctx.ui?.notify?.(
            `Agent model "${agent.model}" not found in model registry`,
            "warning",
          );
        }
      }

      const thinking = agent.thinking ?? agent.effort;
      const thinkingLevel = thinking?.toLowerCase();
      if (
        thinking !== undefined &&
        !VALID_THINKING_LEVELS.has(thinkingLevel ?? "")
      ) {
        ctx.ui?.notify?.(
          `Agent thinking level "${sanitizeTerminalText(thinking)}" is invalid`,
          "warning",
        );
      }
      if (skipModel) {
        // Respect session model/thinking override; do not clobber.
      } else if (preservedThinking !== undefined) {
        // setModel resets thinking to the model/global default, so reapply
        // the level restored from the session transcript.
        if (
          piApi.getThinkingLevel?.() !== preservedThinking &&
          typeof piApi.setThinkingLevel === "function"
        ) {
          piApi.setThinkingLevel(preservedThinking);
        }
      } else if (
        thinkingLevel !== undefined &&
        VALID_THINKING_LEVELS.has(thinkingLevel) &&
        typeof piApi.setThinkingLevel === "function"
      ) {
        piApi.setThinkingLevel(thinkingLevel as ThinkingLevel);
      }

      if (agent.tools?.length) {
        if (typeof piApi.setActiveTools === "function") {
          const allowedTools = filterDirectTools(piApi, agent.tools);
          const dropped = agent.tools.filter(
            (name) => !allowedTools.includes(name),
          );
          piApi.setActiveTools(allowedTools);
          if (dropped.length > 0) {
            ctx.ui?.notify?.(
              `pi-agent: skipped tools not available to the model: ${dropped.map((name) => sanitizeTerminalText(name)).join(", ")}`,
              "warning",
            );
          }
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
      piApi.events?.emit?.("statusline:values", {
        name: "agent",
        text: "",
      });

      if (ctx.sessionManager) {
        updateSessionSnapshot(ctx.sessionManager, "agent", {
          name: null,
          updatedAt: Date.now(),
        });
      }

      if (options.persist && previousAgent?.mode && ctx.sessionManager) {
        enterMode(ctx.sessionManager, "manual");
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

      const existingName = pi.getSessionName()?.trim();
      const strippedName = existingName?.replace(/^\[[^\]]+\]\s*/, "").trim();
      const baseName =
        strippedName !== undefined &&
        strippedName !== "" &&
        strippedName !== "session"
          ? strippedName
          : (firstUserMessageText(branch) ?? agent.name);
      const sessionName = `[${agent.name}] ${baseName}`;

      ctx.ui?.setStatus?.("agent", agent.name);

      if (hasHistory && branch.length > 0 && typeof ctx.fork === "function") {
        const lastEntry = branch[branch.length - 1];
        let forkCtx: ExtensionCommandContext | undefined;
        // ctx.fork invalidates this `pi`; the replacement instance applies
        // the agent from its own session_start (reason "fork").
        pendingForkSlot[PENDING_FORK] = {
          agent,
          sessionName,
          labelId: lastEntry.id,
        };
        try {
          await ctx.fork(lastEntry.id, {
            position: "at",
            withSession: async (replacedCtx) => {
              forkCtx = replacedCtx;
              const { showAgentSwitchPopup } = await import("./popup.js");
              await showAgentSwitchPopup(agent, replacedCtx, {
                sessionName,
                forked: true,
              });
            },
          });
          if (forkCtx) {
            return;
          }
        } catch (error) {
          if (forkCtx) {
            forkCtx.ui?.notify?.(
              `Agent switch failed after fork: ${error instanceof Error ? error.message : String(error)}`,
              "error",
            );
            return;
          }
          // A consumed slot means the replacement session started, so this
          // `pi` is stale and an in-place switch would throw again.
          if (pendingForkSlot[PENDING_FORK] === undefined) throw error;
          // If forking fails before the replacement session starts, fall back
          // to an in-place switch.
        } finally {
          pendingForkSlot[PENDING_FORK] = undefined;
        }
      }

      if (typeof pi.setSessionName === "function") {
        pi.setSessionName(sessionName);
      }
      await applyAgent(agent, ctx, pi, { persist: true, notify: false });
      const { showAgentSwitchPopup } = await import("./popup.js");
      await showAgentSwitchPopup(agent, ctx, { sessionName, forked: false });
    };

    const restore = async (ctx: ExtensionContext): Promise<void> => {
      lastCwd = ctx.cwd;
      lastTrusted = ctx.isProjectTrusted();

      let hasAgentEntry = false;
      let hasHistory = false;
      let persistedName: string | undefined;
      const entries =
        (typeof ctx.sessionManager?.getBranch === "function"
          ? ctx.sessionManager.getBranch()
          : typeof ctx.sessionManager?.getEntries === "function"
            ? ctx.sessionManager.getEntries()
            : []) ?? [];
      for (const entry of entries) {
        const raw = entry as {
          type?: string;
          customType?: string;
          data?: unknown;
        };
        if (raw.type === "message") {
          hasHistory = true;
        }
        if (
          (raw.type === "custom" && raw.customType === ACTIVE_AGENT_TYPE) ||
          raw.type === ACTIVE_AGENT_TYPE
        ) {
          hasAgentEntry = true;
          const data = raw.data as { name?: unknown } | undefined;
          if (typeof data?.name === "string" && data.name.trim() !== "") {
            persistedName = data.name.trim();
          } else if (data?.name === null) {
            persistedName = undefined;
          }
        }
      }

      const discovery = resolveAgentDiscovery(ctx.cwd, ctx.isProjectTrusted());
      const preserveMode = readPersistedMode(ctx.sessionManager) !== undefined;
      for (const d of discovery.diagnostics) {
        ctx.ui?.notify?.(`pi-agent: ${d}`, "warning");
      }
      if (persistedName) {
        const agents = discovery.agents;
        const matched = agents.find(
          (a) => a.name.toLowerCase() === persistedName?.toLowerCase(),
        );
        if (matched) {
          await applyAgent(matched, ctx, pi, {
            persist: false,
            notify: false,
            preserveThinking: true,
            preserveMode,
          });
          return;
        }
        ctx.ui?.notify?.(
          `pi-agent: persisted agent "${persistedName}" not found`,
          "warning",
        );
      }

      if (!hasAgentEntry) {
        const agentConfig = loadAgentConfig({
          agentDir: getAgentDir(),
          cwd: ctx.cwd,
          trusted: ctx.isProjectTrusted(),
        });
        for (const d of agentConfig.diagnostics) {
          ctx.ui?.notify?.(`pi-agent: ${d}`, "warning");
        }
        if (agentConfig.default) {
          const defaultName = agentConfig.default.toLowerCase();
          if (defaultName !== "default" && defaultName !== "none") {
            const matched = discovery.agents.find(
              (a) => a.name.toLowerCase() === defaultName,
            );
            if (matched) {
              await applyAgent(matched, ctx, pi, {
                persist: false,
                notify: false,
                preserveThinking: hasHistory,
                preserveMode,
              });
              return;
            }
            ctx.ui?.notify?.(
              `pi-agent: configured default agent "${agentConfig.default}" not found`,
              "warning",
            );
          }
        }
      }

      if (activeAgent !== undefined) {
        await applyDefault(ctx, pi, { persist: false, notify: false });
        return;
      }

      ctx.ui?.setStatus?.("agent", undefined);
      syncTitle(ctx);
      pi.events?.emit?.("statusline:values", {
        name: "agent",
        text: "",
      });
      if (ctx.sessionManager) {
        updateSessionSnapshot(ctx.sessionManager, "agent", {
          name: null,
          updatedAt: Date.now(),
        });
      }
    };

    pi.on("session_start", async (event, ctx) => {
      const pending =
        event?.reason === "fork" ? pendingForkSlot[PENDING_FORK] : undefined;
      if (pending === undefined) return restore(ctx);
      pendingForkSlot[PENDING_FORK] = undefined;
      lastCwd = ctx.cwd;
      lastTrusted = ctx.isProjectTrusted();
      pi.setSessionName(pending.sessionName);
      if (typeof pi.setLabel === "function") {
        pi.setLabel(pending.labelId, `agent: ${pending.agent.name}`);
      }
      await applyAgent(pending.agent, ctx, pi, {
        persist: true,
        notify: false,
      });
    });
    pi.on("session_tree", (_event, ctx) => restore(ctx));

    pi.on("session_compact", (_event, ctx) => {
      const entries =
        (typeof ctx?.sessionManager?.getBranch === "function"
          ? ctx.sessionManager.getBranch()
          : []) ?? [];
      const { lastAgentIndex, lastModelChangeIndex, lastAgentOverride } =
        findOverrideState(entries);
      // Compaction re-appends the agent entry behind existing model changes,
      // which hides a live override from the next restore's ordering check.
      const overrideMarker =
        lastAgentOverride || lastModelChangeIndex > lastAgentIndex
          ? { modelOverride: true as const }
          : {};
      if (activeAgent) {
        pi.appendEntry(ACTIVE_AGENT_TYPE, {
          ...toAgentEntryData(activeAgent),
          ...overrideMarker,
        });
      } else {
        pi.appendEntry(ACTIVE_AGENT_TYPE, { name: null });
      }
    });
    pi.on("project_trust", (event) => {
      lastCwd = event.cwd;
      lastTrusted = false;
      return { trusted: "undecided" };
    });

    pi.events?.on?.("statusline:request", (data: unknown) => {
      if (typeof data === "object" && data !== null) {
        const names = (data as { names?: unknown }).names;
        if (Array.isArray(names) && !names.includes("agent")) return;
      }
      pi.events?.emit?.("statusline:values", {
        name: "agent",
        text: activeAgent ? sanitizeTerminalText(activeAgent.name) : "",
      });
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

      const sections = event.systemPromptOptions.sections;
      if (!sections || sections.agents?.trim()) return;
      const cwd = ctx?.cwd ?? lastCwd;
      const trusted = ctx?.isProjectTrusted?.() ?? lastTrusted;
      const rosterAgent = resolveRosterAgent(cwd, trusted);
      const names = rosterAgent?.agents;
      if (names === undefined || names.length === 0) return;

      const known = new Map<string, AgentConfig>();
      for (const candidate of resolveAgentDiscovery(cwd, trusted).agents) {
        known.set(candidate.name.toLowerCase(), candidate);
      }
      const roster: Array<{ name: string; description: string }> = [];
      for (const requested of names) {
        const match = known.get(requested.toLowerCase());
        if (match !== undefined) {
          roster.push({ name: match.name, description: match.description });
        } else {
          ctx?.ui?.notify?.(
            `pi-agent: unknown agent "${sanitizeTerminalText(requested)}" in agents roster`,
            "warning",
          );
        }
      }
      const text = renderAgentRoster(roster);
      if (text !== "") sections.agents = text;
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
          {
            value: "reset",
            label: "reset",
            description: "Reset to default agent",
          },
          {
            value: "settings",
            label: "settings",
            description: "Open shared default agent settings",
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
          const { showAgentPicker } = await import("./picker.js");
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
