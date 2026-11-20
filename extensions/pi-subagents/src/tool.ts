import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ExtensionAPI,
  defineTool,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  type RosterAgent,
  formatAgentRosterSection,
} from "@hollowheap/core/agents";
import { isPermissionError } from "@hollowheap/core/config";
import {
  errorMessage,
  sanitizeTerminalText,
  toolErrorResult,
  toolTextResult,
  truncateText,
} from "@hollowheap/core/format";
import { resolveModeName } from "@hollowheap/core/modes";
import { appendSessionEntry, session } from "@hollowheap/core/state";
import { notify } from "@hollowheap/pi-ui/host";
import { isProcessAlive } from "@hollowheap/runtime/process";
import { isOsPermissionError } from "@hollowheap/runtime/sandbox";
import { formatExpandHint } from "@hollowheap/ui/tool-output";
import { Type } from "typebox";
import { type AgentConfig, discoverAgents } from "./agents.js";
import type { SessionAgentDefinition } from "./definitions.js";
import {
  abortSubagent,
  attachSubagent,
  generateSubagentId,
  listSubagents,
  readSubagentLog,
  sendSubagent,
  startSubagent,
  waitSubagent,
} from "./runner.js";
import {
  type SubagentHarnessTransport,
  type SubagentsConfig,
  loadSubagentsConfig,
  resolveSubagentSandboxOptions,
  resolveSubagentWaitTimeoutMs,
} from "./settings.js";
import type { SubagentState } from "./state.js";
import { isInProject, subagentDisplayName } from "./state.js";
import { resolveSubagentModel } from "./swap.js";
import {
  allocateSubagentWorkspace,
  cleanupSubagentWorkspace,
  subagentWorkspaceTracker,
} from "./workspace.js";

export const SUBAGENT_RUN_TYPE = "hollowheap.subagents.run";

export interface SubagentToolOptions {
  onSubagentsChange?: () => void;
  getSessionAgents?: () => readonly AgentConfig[];
  defineSessionAgent?: (definition: SessionAgentDefinition) => void;
  deleteSessionAgent?: (name: string) => boolean;
  pi?: ExtensionAPI;
}

interface ChildSpec {
  command: string;
  args: string[];
  harness: string;
  transport?: SubagentHarnessTransport;
  inputMode: "jsonl" | "text";
  initialInput?: string;
  env?: NodeJS.ProcessEnv;
}

function resolveChildAgentRoster(
  agent: AgentConfig,
  discovery: { agents: readonly AgentConfig[] },
  sessionAgents: readonly AgentConfig[],
  notify?: (message: string) => void,
): string {
  const names = agent.agents;
  if (names === undefined || names.length === 0) return "";
  const known = new Map<string, AgentConfig>();
  for (const candidate of [...sessionAgents, ...discovery.agents]) {
    known.set(candidate.name.toLowerCase(), candidate);
  }
  const roster: RosterAgent[] = [];
  for (const requested of names) {
    const match = known.get(requested.toLowerCase());
    if (match !== undefined) {
      roster.push({ name: match.name, description: match.description });
    } else {
      notify?.(`pi-subagents: unknown agent "${requested}" in agents roster`);
    }
  }
  return formatAgentRosterSection(roster);
}

function piChildSpec(
  agent: AgentConfig,
  sessionPath: string,
  rosterSection = "",
): ChildSpec {
  const require = createRequire(import.meta.url);
  let policyDir: string;
  try {
    policyDir = dirname(require.resolve("@hollowheap/policy/package.json"));
  } catch {
    throw new Error("pi-policy is required to run subagents");
  }
  const args = [
    "--mode",
    "rpc",
    "--no-themes",
    "-ne",
    "-e",
    join(policyDir, "index.ts"),
    "-e",
    fileURLToPath(new URL("../child.ts", import.meta.url)),
    "--append-system-prompt",
    rosterSection === ""
      ? agent.systemPrompt
      : `${agent.systemPrompt}\n\n${rosterSection}`,
    "--session",
    sessionPath,
  ];
  if (agent.model !== undefined) args.push("--model", agent.model);
  const thinking = agent.thinking;
  if (thinking !== undefined) args.push("--thinking", thinking);
  if (agent.tools !== undefined) args.push("--tools", agent.tools.join(","));
  return {
    command: process.env.PI_BIN ?? "pi",
    args,
    harness: "pi",
    inputMode: "jsonl",
  };
}

function childSpec(
  agent: AgentConfig,
  task: string,
  sessionPath: string,
  config: SubagentsConfig,
  rosterSection = "",
): ChildSpec {
  if (agent.harness === undefined || agent.harness === "pi") {
    return piChildSpec(agent, sessionPath, rosterSection);
  }
  const harness = Object.hasOwn(config.harnesses, agent.harness)
    ? config.harnesses[agent.harness]
    : undefined;
  if (harness === undefined) {
    throw new Error(`unknown harness "${agent.harness}"`);
  }
  const systemPrompt = agent.systemPrompt.trim();
  const prompt = systemPrompt === "" ? task : `${systemPrompt}\n\n${task}`;
  const args = [...harness.args];
  let initialInput: string | undefined;
  if (harness.input === "arg") {
    const index = args.findIndex((arg) => arg.includes("{prompt}"));
    if (index >= 0) {
      args[index] = args[index].replaceAll("{prompt}", prompt);
    } else {
      args.push(prompt);
    }
  } else {
    initialInput = prompt;
  }
  return {
    command: harness.command,
    args,
    harness: agent.harness,
    ...(harness.transport !== undefined
      ? { transport: harness.transport }
      : {}),
    inputMode: "text",
    ...(initialInput !== undefined ? { initialInput } : {}),
    ...(harness.env !== undefined ? { env: { ...harness.env } } : {}),
  };
}

function errorResult(message: string) {
  return toolErrorResult("subagent unavailable", message);
}

function loadToolSubagentsConfig(
  agentDir: string,
  ctx: Parameters<typeof notify>[0] & { hasUI?: boolean },
): SubagentsConfig {
  return loadSubagentsConfig(agentDir, (message) => {
    if (ctx.hasUI) {
      notify(
        ctx,
        `pi-subagents: ${message}`,
        isPermissionError(message) ? "error" : "warning",
      );
    }
  });
}

function textResult(details: Record<string, unknown>) {
  return toolTextResult(JSON.stringify(details), details);
}

function summary(state: SubagentState): Record<string, unknown> {
  return {
    id: state.id,
    status: state.status,
    agent: state.agent,
    task: state.task,
    depth: state.depth,
    attempt: state.attempt,
    ...(state.model !== undefined ? { model: state.model } : {}),
    ...(state.workspace !== undefined ? { workspace: state.workspace } : {}),
    ...(state.pid !== undefined ? { pid: state.pid } : {}),
    startedAt: state.startedAt,
    ...(state.finishedAt !== undefined ? { finishedAt: state.finishedAt } : {}),
    ...(state.exitCode !== undefined ? { exitCode: state.exitCode } : {}),
    ...(state.harness !== undefined ? { harness: state.harness } : {}),
    ...(state.transport !== undefined ? { transport: state.transport } : {}),
  };
}

/** Keep `list` compact: the UI only needs a title, while `status` keeps the full task. */
function listSummary(state: SubagentState): Record<string, unknown> {
  const task =
    state.task.length > 80 ? `${state.task.slice(0, 77)}...` : state.task;
  return { ...summary(state), task };
}

function stateWithLog(
  agentDir: string,
  state: SubagentState,
): Record<string, unknown> {
  const log = readSubagentLog(agentDir, state.id);
  return {
    ...summary(state),
    ...(state.socket !== undefined ? { socket: state.socket } : {}),
    ...(state.session !== undefined ? { session: state.session } : {}),
    log: log.trim() === "" ? "" : truncateText(log, "pi-subagents"),
  };
}

function firstText(result: { content?: readonly unknown[] }): string {
  const item = result.content?.[0] as
    | { type?: string; text?: string }
    | undefined;
  return item && typeof item.text === "string" ? item.text : "";
}

export function createSubagentTool(options: SubagentToolOptions = {}) {
  return defineTool({
    name: "subagent",
    label: "subagent",
    description:
      "Start and manage one durable child agent (define, delete, start, list, status, send, wait, cancel).",
    exposure: "direct",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("define"),
        Type.Literal("delete"),
        Type.Literal("start"),
        Type.Literal("list"),
        Type.Literal("status"),
        Type.Literal("send"),
        Type.Literal("wait"),
        Type.Literal("cancel"),
        Type.Literal("resume"),
      ]),
      name: Type.Optional(
        Type.String({ description: "Agent name for define or delete" }),
      ),
      description: Type.Optional(
        Type.String({ description: "Agent description for define" }),
      ),
      systemPrompt: Type.Optional(
        Type.String({ description: "Child system prompt for define" }),
      ),
      tools: Type.Optional(
        Type.Array(Type.String(), {
          description: "Tool allowlist for define",
        }),
      ),
      model: Type.Optional(
        Type.String({ description: "Model override for define" }),
      ),
      thinking: Type.Optional(
        Type.String({ description: "Thinking level for define" }),
      ),
      agentMode: Type.Optional(
        Type.String({ description: "Mode name for define" }),
      ),
      effort: Type.Optional(
        Type.String({ description: "Effort override for define" }),
      ),
      harness: Type.Optional(
        Type.String({ description: "Harness name for define or start" }),
      ),
      agent: Type.Optional(
        Type.String({ description: "Agent name for start" }),
      ),
      task: Type.Optional(
        Type.String({ description: "Task prompt for start" }),
      ),
      id: Type.Optional(
        Type.String({ description: "Subagent id for status/send/wait/cancel" }),
      ),
      message: Type.Optional(Type.String({ description: "Message for send" })),
      mode: Type.Optional(
        Type.Union([
          Type.Literal("steer"),
          Type.Literal("prompt"),
          Type.Literal("follow_up"),
        ]),
      ),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
      isolated: Type.Optional(
        Type.Boolean({
          description: "Run in a dedicated isolated workspace",
        }),
      ),
    }),
    renderCall(args, theme, context) {
      const text =
        context?.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      const rawAction = args?.action ?? "subagent";
      const action = sanitizeTerminalText(rawAction);
      let line = `${theme.fg("toolTitle", theme.bold("subagent"))} ${theme.fg("accent", action)}`;
      if (rawAction === "define" || rawAction === "delete") {
        const name = args?.name ?? args?.agent;
        if (name)
          line += ` ${theme.fg("toolTitle", sanitizeTerminalText(name))}`;
        if (rawAction === "define" && args?.systemPrompt) {
          line += ` ${theme.fg("muted", `${args.systemPrompt.length} chars`)}`;
        }
      } else if (rawAction === "start") {
        if (args?.agent) {
          line += ` ${theme.fg("toolTitle", sanitizeTerminalText(args.agent))}`;
        }
        if (args?.task) {
          const safeTask = sanitizeTerminalText(args.task);
          const taskSummary =
            safeTask.length > 60 ? `${safeTask.slice(0, 57)}...` : safeTask;
          line += ` ${theme.fg("muted", `"${taskSummary}"`)}`;
        }
      } else if (args?.id) {
        line += ` ${theme.fg("dim", `@${sanitizeTerminalText(args.id)}`)}`;
        if (rawAction === "send" && args?.message) {
          const safeMessage = sanitizeTerminalText(args.message);
          const msg =
            safeMessage.length > 40
              ? `${safeMessage.slice(0, 37)}...`
              : safeMessage;
          line += ` ${theme.fg("muted", `"${msg}"`)}`;
        }
      }
      text.setText(line);
      return text;
    },
    renderResult(result, options, theme, context) {
      const text =
        context?.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      const details = result.details as Record<string, unknown> | undefined;
      const textOutput = firstText(result);
      if (!details || details.error) {
        text.setText(
          theme.fg(
            "error",
            textOutput !== ""
              ? sanitizeTerminalText(textOutput)
              : "Subagent action failed",
          ),
        );
        return text;
      }

      if (typeof details.defined === "string") {
        text.setText(
          `${theme.fg("success", "✓")} ${theme.fg("muted", "session agent")} ${theme.fg("toolTitle", sanitizeTerminalText(details.defined))}`,
        );
        return text;
      }

      if (typeof details.deleted === "string") {
        text.setText(
          `${theme.fg("success", "✓")} ${theme.fg("muted", "removed session agent")} ${theme.fg("toolTitle", sanitizeTerminalText(details.deleted))}`,
        );
        return text;
      }

      if (Array.isArray(details.agents)) {
        const agents = details.agents as Array<{
          id: string;
          status: string;
          agent: string;
          task?: string;
          model?: string;
          workspace?: string;
        }>;
        if (agents.length === 0) {
          text.setText(theme.fg("muted", "No active subagents."));
          return text;
        }
        const lines: string[] = [
          `${theme.fg("toolTitle", "Subagents")} ${theme.fg("muted", `(${agents.length} active):`)}`,
        ];
        for (const a of agents) {
          const icon =
            a.status === "running"
              ? theme.fg("warning", "●")
              : theme.fg("success", "✓");
          const name = sanitizeTerminalText(
            subagentDisplayName({
              model: a.model,
              agent: a.agent,
              task: a.task ?? "",
            }),
          );
          const model = a.model
            ? ` ${theme.fg("dim", `(${sanitizeTerminalText(a.model)})`)}`
            : "";
          const location = a.workspace
            ? ` ${theme.fg("dim", sanitizeTerminalText(a.workspace))}`
            : "";
          lines.push(
            `  ${icon} ${theme.fg("accent", `[${sanitizeTerminalText(a.status)}]`)} ${theme.fg("toolTitle", name)}${model}${location}`,
          );
        }
        text.setText(lines.join("\n"));
        return text;
      }

      const status = String(details.status ?? "");
      const safeStatus = sanitizeTerminalText(status);
      const agent = String(details.agent ?? "");
      const exitCode = details.exitCode;
      const log = typeof details.log === "string" ? details.log : "";

      let icon = theme.fg("muted", "○");
      if (status === "running") {
        icon = theme.fg("warning", "●");
      } else if (status === "completed" || status === "succeeded") {
        icon = theme.fg("success", "✓");
      } else if (status === "failed" || status === "error") {
        icon = theme.fg("error", "✗");
      } else if (status === "cancelled" || status === "aborted") {
        icon = theme.fg("muted", "⊘");
      }

      const displayName = sanitizeTerminalText(
        subagentDisplayName({
          model: typeof details.model === "string" ? details.model : undefined,
          agent,
          task: typeof details.task === "string" ? details.task : "",
        }),
      );
      let header = `${icon} ${theme.fg("accent", `[${safeStatus}]`)} ${theme.fg("toolTitle", displayName)}`;
      if (typeof details.model === "string") {
        header += ` ${theme.fg("dim", `(${sanitizeTerminalText(details.model)})`)}`;
      }
      if (typeof details.workspace === "string") {
        header += ` ${theme.fg("dim", sanitizeTerminalText(details.workspace))}`;
      }
      if (exitCode !== undefined) {
        header += ` ${theme.fg("dim", `(exit ${exitCode})`)}`;
      }

      const lines: string[] = [header];
      if (log.trim().length > 0) {
        const logLines = log.split("\n").filter((l) => l.trim().length > 0);
        const maxLines = options.expanded ? logLines.length : 6;
        const displayed = logLines.slice(-maxLines);
        const hidden = logLines.length - displayed.length;

        if (hidden > 0) {
          lines.push(
            `  ${formatExpandHint(hidden, "earlier log lines", theme)}`,
          );
        }
        for (const l of displayed) {
          lines.push(`  ${theme.fg("toolOutput", sanitizeTerminalText(l))}`);
        }
      }

      text.setText(lines.join("\n"));
      return text;
    },
    async execute(_toolCallId, raw, signal, _onUpdate, ctx) {
      const params = (raw ?? {}) as {
        action?: string;
        name?: string;
        description?: string;
        systemPrompt?: string;
        tools?: string[];
        model?: string;
        thinking?: string;
        agentMode?: string;
        effort?: string;
        harness?: string;
        agent?: string;
        task?: string;
        id?: string;
        message?: string;
        mode?: "steer" | "prompt" | "follow_up";
        timeoutMs?: number;
        isolated?: boolean;
      };
      const agentDir = getAgentDir();
      const action = params.action;
      try {
        if (action === "delete") {
          const name = (params.name ?? params.agent ?? "").trim();
          if (name === "") return errorResult("delete requires name");
          if (options.deleteSessionAgent === undefined) {
            return errorResult("session agent definitions are unavailable");
          }
          if (!options.deleteSessionAgent(name)) {
            return errorResult(`unknown session agent "${name}"`);
          }
          return textResult({ deleted: name, source: "session" });
        }

        if (action === "define") {
          const name = (params.name ?? params.agent ?? "").trim();
          const systemPrompt = params.systemPrompt?.trim() ?? "";
          if (name === "" || systemPrompt === "") {
            return errorResult("define requires name and systemPrompt");
          }
          if (options.defineSessionAgent === undefined) {
            return errorResult("session agent definitions are unavailable");
          }
          const tools = params.tools
            ?.map((tool) => tool.trim())
            .filter(Boolean);
          const definition: SessionAgentDefinition = {
            name,
            description: params.description?.trim() || `Session agent ${name}`,
            systemPrompt,
            ...(tools && tools.length > 0 ? { tools } : {}),
            ...(params.model?.trim() ? { model: params.model.trim() } : {}),
            ...(params.thinking?.trim()
              ? { thinking: params.thinking.trim() }
              : {}),
            ...(params.agentMode?.trim()
              ? { mode: params.agentMode.trim() }
              : {}),
            ...(params.effort?.trim() ? { effort: params.effort.trim() } : {}),
            ...(params.harness?.trim()
              ? { harness: params.harness.trim() }
              : {}),
          };
          const config = loadToolSubagentsConfig(agentDir, ctx);
          const bytes = Buffer.byteLength(JSON.stringify(definition), "utf8");
          if (bytes > config.maxSessionAgentBytes) {
            return errorResult(
              `session agent definition is ${bytes} bytes; maxSessionAgentBytes is ${config.maxSessionAgentBytes}`,
            );
          }
          const sessionAgents = options.getSessionAgents?.() ?? [];
          if (
            !sessionAgents.some((agent) => agent.name === name) &&
            sessionAgents.length >= config.maxSessionAgents
          ) {
            return errorResult(
              `maxSessionAgents ${config.maxSessionAgents} reached`,
            );
          }
          options.defineSessionAgent(definition);
          return textResult({ defined: name, source: "session" });
        }

        if (action === "list") {
          const agents = await listSubagents(agentDir);
          return textResult({
            agents: agents
              .filter((state) => isInProject(state, ctx.cwd))
              .map(listSummary),
          });
        }

        if (action === "start") {
          if (!ctx.isProjectTrusted()) {
            return errorResult("start requires a trusted project");
          }
          const name = params.agent?.trim() ?? "";
          const task = params.task?.trim() ?? "";
          if (name === "" || task === "") {
            return errorResult("start requires agent and task");
          }
          const config = loadToolSubagentsConfig(agentDir, ctx);
          const depth =
            Number.parseInt(process.env.PI_SUBAGENT_DEPTH ?? "0", 10) + 1;
          if (!Number.isInteger(depth) || depth < 1) {
            return errorResult("invalid subagent depth");
          }
          if (depth > config.maxDepth) {
            return errorResult(
              `subagent depth ${depth} exceeds maxDepth ${config.maxDepth}`,
            );
          }
          const parentSession = ctx.sessionManager?.getSessionId?.();
          const running = (await listSubagents(agentDir)).filter(
            (state) =>
              state.parentSession === parentSession &&
              (state.status === "running" || state.status === "starting"),
          ).length;
          if (running >= config.maxConcurrent) {
            return errorResult(`maxConcurrent ${config.maxConcurrent} reached`);
          }
          const discovery = discoverAgents({
            cwd: ctx.cwd,
            agentDir,
            trusted: true,
          });
          const sessionAgents = options.getSessionAgents?.() ?? [];
          const configuredAgent =
            sessionAgents.find((item) => item.name === name) ??
            discovery.agents.find((item) => item.name === name);
          if (configuredAgent === undefined) {
            const names = [...sessionAgents, ...discovery.agents].map(
              (item) => item.name,
            );
            return errorResult(
              `unknown agent "${name}"; available: ${names.join(", ") || "none"}`,
            );
          }
          const harness = params.harness?.trim();
          const agent = harness
            ? { ...configuredAgent, harness }
            : configuredAgent;
          const usesPiHarness =
            agent.harness === undefined || agent.harness === "pi";
          const resolvedModel = usesPiHarness
            ? await resolveSubagentModel(agent, ctx)
            : undefined;
          const effectiveAgent =
            resolvedModel !== undefined
              ? { ...agent, model: resolvedModel }
              : agent;
          const id = generateSubagentId();
          const sessionPath = join(
            agentDir,
            "subagents",
            `${id}.session.jsonl`,
          );
          const rosterSection = resolveChildAgentRoster(
            effectiveAgent,
            discovery,
            sessionAgents,
            (message) => notify(ctx, message, "warning"),
          );
          const spec = childSpec(
            effectiveAgent,
            task,
            sessionPath,
            config,
            rosterSection,
          );
          const parentMode = ctx.sessionManager
            ? session(ctx.sessionManager).mode
            : undefined;
          const effectiveMode =
            parentMode && resolveModeName(parentMode) !== "manual"
              ? parentMode
              : effectiveAgent.mode === "plan"
                ? "plan"
                : "manual";
          const sandbox = resolveSubagentSandboxOptions(
            config,
            effectiveAgent.name,
          );
          const workspace = await allocateSubagentWorkspace({
            root: ctx.cwd,
            id,
            enabled: params.isolated === true,
          });
          let state: SubagentState;
          try {
            state = await startSubagent({
              agentDir,
              id,
              agent: effectiveAgent.name,
              task,
              depth,
              project: ctx.cwd,
              ...(parentSession !== undefined ? { parentSession } : {}),
              command: spec.command,
              args: spec.args,
              cwd: workspace.path,
              workspace: workspace.path,
              isolated: workspace.isolated,
              harness: spec.harness,
              ...(spec.transport !== undefined
                ? { transport: spec.transport }
                : {}),
              inputMode: spec.inputMode,
              ...(spec.initialInput !== undefined
                ? { initialInput: spec.initialInput }
                : {}),
              env: {
                ...(spec.env ?? {}),
                PI_SUBAGENT_DEPTH: String(depth),
                PI_SUBAGENT_ID: id,
                PI_SUBAGENT_MODE: effectiveMode,
              },
              ...(effectiveAgent.model !== undefined
                ? { model: effectiveAgent.model }
                : {}),
              ...(spec.harness === "pi" ? { sessionPath } : {}),
              sandbox: sandbox ?? false,
            });
          } catch (error) {
            await cleanupSubagentWorkspace(workspace).catch(() => {});
            throw error;
          }
          subagentWorkspaceTracker.track(state.id, workspace);
          appendSessionEntry(
            options.pi,
            ctx.sessionManager,
            SUBAGENT_RUN_TYPE,
            {
              id: state.id,
              agent: state.agent,
              task: state.task,
              startedAt: state.startedAt,
            },
          );
          options.onSubagentsChange?.();
          if (spec.inputMode === "jsonl") {
            try {
              await sendSubagent(agentDir, state.id, {
                id: Math.floor(Math.random() * 1_000_000_000),
                type: "prompt",
                message: task,
              });
            } catch (error) {
              await abortSubagent(agentDir, state.id).catch(() => {});
              options.onSubagentsChange?.();
              throw error;
            }
          }
          options.onSubagentsChange?.();
          return textResult(stateWithLog(agentDir, state));
        }

        const id = params.id?.trim() ?? "";
        if (id === "") return errorResult(`${String(action)} requires id`);
        if (action === "status") {
          const state = await attachSubagent(agentDir, id);
          if (state === undefined || !isInProject(state, ctx.cwd)) {
            return errorResult(`unknown id: ${id}`);
          }
          return textResult(stateWithLog(agentDir, state));
        }
        if (action === "send") {
          const message = params.message?.trim() ?? "";
          if (message === "") return errorResult("send requires message");
          const mode = params.mode ?? "steer";
          const state = await attachSubagent(agentDir, id);
          if (state === undefined || !isInProject(state, ctx.cwd)) {
            return errorResult(`unknown id: ${id}`);
          }
          await sendSubagent(
            agentDir,
            id,
            state.inputMode === "text"
              ? message
              : {
                  id: Math.floor(Math.random() * 1_000_000_000),
                  type: mode,
                  message,
                },
          );
          options.onSubagentsChange?.();
          return textResult({ id, mode });
        }
        if (action === "wait") {
          const config = loadToolSubagentsConfig(agentDir, ctx);
          const timeoutMs = resolveSubagentWaitTimeoutMs(
            config,
            params.timeoutMs,
          );
          const current = await attachSubagent(agentDir, id);
          if (current === undefined || !isInProject(current, ctx.cwd)) {
            return errorResult(`unknown id: ${id}`);
          }
          // Stay non-modal: the editor keeps working, so the user can queue a
          // steering message while the child runs. Aborting the turn stops the wait.
          const state = await waitSubagent(agentDir, id, timeoutMs, signal);
          options.onSubagentsChange?.();
          if (state === undefined) return errorResult(`unknown id: ${id}`);
          if (signal?.aborted) {
            const latest = await waitSubagent(agentDir, id, 0);
            if (latest === undefined) return errorResult(`unknown id: ${id}`);
            return textResult({
              ...stateWithLog(agentDir, latest),
              waitCancelled: true,
            });
          }
          return textResult(stateWithLog(agentDir, state));
        }
        if (action === "cancel") {
          const current = await attachSubagent(agentDir, id);
          if (current === undefined || !isInProject(current, ctx.cwd)) {
            return errorResult(`unknown id: ${id}`);
          }
          await abortSubagent(agentDir, id);
          const state = await waitSubagent(agentDir, id, 1_000);
          options.onSubagentsChange?.();
          if (state === undefined) return errorResult(`unknown id: ${id}`);
          return textResult(stateWithLog(agentDir, state));
        }
        if (action === "resume") {
          if (!ctx.isProjectTrusted()) {
            return errorResult("resume requires a trusted project");
          }
          const state = await attachSubagent(agentDir, id);
          if (state === undefined || !isInProject(state, ctx.cwd)) {
            return errorResult(`unknown id: ${id}`);
          }
          if (state.status !== "failed") {
            return errorResult(
              `only failed subagents can resume: ${state.status}`,
            );
          }
          if (
            state.pid !== undefined &&
            isProcessAlive(state.pid, state.startTime)
          ) {
            return errorResult(
              `cannot resume subagent ${id}: process ${state.pid} is still alive`,
            );
          }
          const config = loadToolSubagentsConfig(agentDir, ctx);
          if (state.depth > config.maxDepth) {
            return errorResult(
              `subagent depth ${state.depth} exceeds maxDepth ${config.maxDepth}`,
            );
          }
          const parentSession = ctx.sessionManager?.getSessionId?.();
          const running = (await listSubagents(agentDir)).filter(
            (item) =>
              item.parentSession === parentSession &&
              (item.status === "running" || item.status === "starting"),
          ).length;
          if (running >= config.maxConcurrent) {
            return errorResult(`maxConcurrent ${config.maxConcurrent} reached`);
          }
          const discovery = discoverAgents({
            cwd: ctx.cwd,
            agentDir,
            trusted: true,
          });
          const sessionAgents = options.getSessionAgents?.() ?? [];
          const agent =
            sessionAgents.find((item) => item.name === state.agent) ??
            discovery.agents.find((item) => item.name === state.agent);
          if (agent === undefined) {
            const names = [...sessionAgents, ...discovery.agents].map(
              (item) => item.name,
            );
            return errorResult(
              `unknown agent "${state.agent}"; available: ${names.join(", ") || "none"}`,
            );
          }
          const sessionPath =
            state.session ?? join(agentDir, "subagents", `${id}.session.jsonl`);
          const resumeAgent =
            state.harness !== undefined
              ? { ...agent, harness: state.harness }
              : agent;
          const usesPiHarness =
            resumeAgent.harness === undefined || resumeAgent.harness === "pi";
          const modelToUse = state.model ?? resumeAgent.model;
          const resolvedModel = usesPiHarness
            ? await resolveSubagentModel(
                { ...resumeAgent, model: modelToUse },
                ctx,
              )
            : undefined;
          const effectiveAgent =
            resolvedModel !== undefined
              ? { ...resumeAgent, model: resolvedModel }
              : resumeAgent;
          const rosterSection = resolveChildAgentRoster(
            effectiveAgent,
            discovery,
            sessionAgents,
            (message) => notify(ctx, message, "warning"),
          );
          const spec = childSpec(
            effectiveAgent,
            state.task,
            sessionPath,
            config,
            rosterSection,
          );
          const transport = state.transport ?? spec.transport;
          const parentMode = ctx.sessionManager
            ? session(ctx.sessionManager).mode
            : undefined;
          const effectiveMode =
            parentMode && resolveModeName(parentMode) !== "manual"
              ? parentMode
              : effectiveAgent.mode === "plan"
                ? "plan"
                : "manual";
          const workspace = await allocateSubagentWorkspace({
            root: ctx.cwd,
            id,
            enabled: state.isolated === true,
          });
          let resumed: SubagentState;
          try {
            resumed = await startSubagent({
              agentDir,
              id,
              agent: effectiveAgent.name,
              task: state.task,
              depth: state.depth,
              attempt: state.attempt + 1,
              project: ctx.cwd,
              ...(state.parentSession !== undefined
                ? { parentSession: state.parentSession }
                : {}),
              command: spec.command,
              args: spec.args,
              cwd: workspace.path,
              workspace: workspace.path,
              isolated: workspace.isolated,
              harness: spec.harness,
              ...(transport !== undefined ? { transport } : {}),
              inputMode: spec.inputMode,
              ...(spec.initialInput !== undefined
                ? { initialInput: spec.initialInput }
                : {}),
              env: {
                ...(spec.env ?? {}),
                PI_SUBAGENT_DEPTH: String(state.depth),
                PI_SUBAGENT_ID: id,
                PI_SUBAGENT_MODE: effectiveMode,
              },
              ...(effectiveAgent.model !== undefined
                ? { model: effectiveAgent.model }
                : {}),
              ...(spec.harness === "pi" ? { sessionPath } : {}),
              sandbox:
                resolveSubagentSandboxOptions(config, effectiveAgent.name) ??
                false,
            });
          } catch (error) {
            await cleanupSubagentWorkspace(workspace).catch(() => {});
            throw error;
          }
          subagentWorkspaceTracker.track(resumed.id, workspace);
          options.onSubagentsChange?.();
          if (spec.inputMode === "jsonl") {
            try {
              await sendSubagent(agentDir, id, {
                id: Math.floor(Math.random() * 1_000_000_000),
                type: "prompt",
                message: state.task,
              });
            } catch (error) {
              await abortSubagent(agentDir, id).catch(() => {});
              options.onSubagentsChange?.();
              throw error;
            }
          }
          return textResult(stateWithLog(agentDir, resumed));
        }
        return errorResult(`invalid action: ${String(action)}`);
      } catch (error) {
        const message = errorMessage(error);
        if (
          ctx.hasUI &&
          (isPermissionError(error) || isOsPermissionError(error))
        ) {
          notify(ctx, `pi-subagents: ${message}`, "error");
        }
        return errorResult(message);
      }
    },
  });
}
