import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import {
  type Theme,
  defineTool,
  getAgentDir,
  keyHint,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { truncateText } from "@hollowheap/core/format";
import { session } from "@hollowheap/core/state";
import { withCancellableProgress } from "@hollowheap/tui/progress";
import { type AgentConfig, discoverAgents } from "./agents.js";
import { type SubagentsConfig, loadSubagentsConfig } from "./config.js";
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
import type { SubagentState } from "./state.js";
import { resolveSubagentModel } from "./swap.js";
import {
  allocateSubagentWorkspace,
  cleanupSubagentWorkspace,
  subagentWorkspaceTracker,
} from "./workspace.js";

export interface SubagentToolOptions {
  onSubagentsChange?: () => void;
  getSessionAgents?: () => readonly AgentConfig[];
  defineSessionAgent?: (definition: SessionAgentDefinition) => void;
}

interface ChildSpec {
  command: string;
  args: string[];
  harness: string;
  inputMode: "jsonl" | "text";
  initialInput?: string;
  env?: NodeJS.ProcessEnv;
}

function piChildSpec(agent: AgentConfig, sessionPath: string): ChildSpec {
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
    agent.systemPrompt,
    "--session",
    sessionPath,
  ];
  if (agent.model !== undefined) args.push("--model", agent.model);
  if (agent.thinking !== undefined) args.push("--thinking", agent.thinking);
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
): ChildSpec {
  if (agent.harness === undefined || agent.harness === "pi") {
    return piChildSpec(agent, sessionPath);
  }
  const harness = config.harnesses[agent.harness];
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
    inputMode: "text",
    ...(initialInput !== undefined ? { initialInput } : {}),
    ...(harness.env !== undefined ? { env: { ...harness.env } } : {}),
  };
}

function errorResult(message: string) {
  return {
    content: [
      { type: "text" as const, text: `subagent unavailable: ${message}` },
    ],
    details: { error: message },
  };
}

function textResult(details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details) }],
    details,
  };
}

function summary(state: SubagentState): Record<string, unknown> {
  return {
    id: state.id,
    status: state.status,
    agent: state.agent,
    depth: state.depth,
    attempt: state.attempt,
    ...(state.pid !== undefined ? { pid: state.pid } : {}),
    startedAt: state.startedAt,
    ...(state.finishedAt !== undefined ? { finishedAt: state.finishedAt } : {}),
    ...(state.exitCode !== undefined ? { exitCode: state.exitCode } : {}),
    ...(state.harness !== undefined ? { harness: state.harness } : {}),
  };
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

function expandHint(theme: Theme, count: number, noun: string): string {
  let hint = "to expand";
  try {
    hint = keyHint("app.tools.expand", "to expand");
  } catch {
    hint = "[Space] to expand";
  }
  return `${theme.fg("muted", `... (${count} more ${noun},`)} ${hint}${theme.fg("muted", ")")}`;
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
      "Start and manage one durable child agent (define, start, list, status, send, wait, cancel).",
    exposure: "direct",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("define"),
        Type.Literal("start"),
        Type.Literal("list"),
        Type.Literal("status"),
        Type.Literal("send"),
        Type.Literal("wait"),
        Type.Literal("cancel"),
        Type.Literal("resume"),
      ]),
      name: Type.Optional(
        Type.String({ description: "Agent name for define" }),
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
        Type.String({ description: "Harness name for define" }),
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
      const action = args?.action ?? "subagent";
      let line = `${theme.fg("toolTitle", theme.bold("subagent"))} ${theme.fg("accent", action)}`;
      if (action === "define") {
        const name = args?.name ?? args?.agent;
        if (name) line += ` ${theme.fg("toolTitle", name)}`;
        if (args?.systemPrompt) {
          line += ` ${theme.fg("muted", `${args.systemPrompt.length} chars`)}`;
        }
      } else if (action === "start") {
        if (args?.agent) line += ` ${theme.fg("toolTitle", args.agent)}`;
        if (args?.task) {
          const taskSummary =
            args.task.length > 60 ? `${args.task.slice(0, 57)}...` : args.task;
          line += ` ${theme.fg("muted", `"${taskSummary}"`)}`;
        }
      } else if (args?.id) {
        line += ` ${theme.fg("dim", `@${args.id}`)}`;
        if (action === "send" && args?.message) {
          const msg =
            args.message.length > 40
              ? `${args.message.slice(0, 37)}...`
              : args.message;
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
            textOutput !== "" ? textOutput : "Subagent action failed",
          ),
        );
        return text;
      }

      if (Array.isArray(details.agents)) {
        const agents = details.agents as Array<{
          id: string;
          status: string;
          agent: string;
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
          lines.push(
            `  ${icon} ${theme.fg("toolTitle", `@${a.id}`)} ${theme.fg("accent", `[${a.status}]`)} ${theme.fg("muted", a.agent)}`,
          );
        }
        text.setText(lines.join("\n"));
        return text;
      }

      const id = String(details.id ?? "");
      const status = String(details.status ?? "");
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

      let header = `${icon} ${theme.fg("toolTitle", `@${id}`)} ${theme.fg("accent", `[${status}]`)} ${theme.fg("muted", agent)}`;
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
          lines.push(`  ${expandHint(theme, hidden, "earlier log lines")}`);
        }
        for (const l of displayed) {
          lines.push(`  ${theme.fg("toolOutput", l)}`);
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
          options.defineSessionAgent({
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
          });
          return textResult({ defined: name, source: "session" });
        }

        if (action === "list") {
          const agents = await listSubagents(agentDir);
          return textResult({ agents: agents.map(summary) });
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
          const config = loadSubagentsConfig(agentDir);
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
          const running = (await listSubagents(agentDir)).filter(
            (state) =>
              state.status === "running" || state.status === "starting",
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
            sessionAgents.find((item) => item.name === name) ??
            discovery.agents.find((item) => item.name === name);
          if (agent === undefined) {
            const names = [...sessionAgents, ...discovery.agents].map(
              (item) => item.name,
            );
            return errorResult(
              `unknown agent "${name}"; available: ${names.join(", ") || "none"}`,
            );
          }
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
          const workspace = await allocateSubagentWorkspace({
            root: ctx.cwd,
            id,
            enabled: params.isolated === true,
          });
          const sessionPath = join(
            agentDir,
            "subagents",
            `${id}.session.jsonl`,
          );
          const spec = childSpec(effectiveAgent, task, sessionPath, config);
          const parentMode = ctx.sessionManager
            ? session(ctx.sessionManager).mode
            : undefined;
          const effectiveMode =
            parentMode && parentMode !== "ask"
              ? parentMode
              : (effectiveAgent.mode ?? "ask");
          const parentSession = ctx.sessionManager?.getSessionId?.();
          let state: SubagentState;
          try {
            state = await startSubagent({
              agentDir,
              id,
              agent: effectiveAgent.name,
              task,
              depth,
              ...(parentSession !== undefined ? { parentSession } : {}),
              command: spec.command,
              args: spec.args,
              cwd: workspace.path,
              harness: spec.harness,
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
            });
          } catch (error) {
            await cleanupSubagentWorkspace(workspace).catch(() => {});
            throw error;
          }
          subagentWorkspaceTracker.track(state.id, workspace);
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
          if (state === undefined) return errorResult(`unknown id: ${id}`);
          return textResult(stateWithLog(agentDir, state));
        }
        if (action === "send") {
          const message = params.message?.trim() ?? "";
          if (message === "") return errorResult("send requires message");
          const mode = params.mode ?? "steer";
          const state = await attachSubagent(agentDir, id);
          if (state === undefined) return errorResult(`unknown id: ${id}`);
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
          const timeoutMs = Math.min(params.timeoutMs ?? 30_000, 600_000);
          const waited = await withCancellableProgress(
            ctx,
            `Waiting for subagent ${id}`,
            (waitSignal) => waitSubagent(agentDir, id, timeoutMs, waitSignal),
            signal,
          );
          options.onSubagentsChange?.();
          if (waited.status === "cancelled") {
            const current = await waitSubagent(agentDir, id, 0);
            if (current === undefined) return errorResult(`unknown id: ${id}`);
            return textResult({
              ...stateWithLog(agentDir, current),
              waitCancelled: true,
            });
          }
          const state = waited.value;
          if (state === undefined) return errorResult(`unknown id: ${id}`);
          return textResult(stateWithLog(agentDir, state));
        }
        if (action === "cancel") {
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
          if (state === undefined) return errorResult(`unknown id: ${id}`);
          if (state.status !== "failed") {
            return errorResult(
              `only failed subagents can resume: ${state.status}`,
            );
          }
          const config = loadSubagentsConfig(agentDir);
          if (state.depth > config.maxDepth) {
            return errorResult(
              `subagent depth ${state.depth} exceeds maxDepth ${config.maxDepth}`,
            );
          }
          const running = (await listSubagents(agentDir)).filter(
            (item) => item.status === "running" || item.status === "starting",
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
          const spec = childSpec(
            effectiveAgent,
            state.task,
            sessionPath,
            config,
          );
          const parentMode = ctx.sessionManager
            ? session(ctx.sessionManager).mode
            : undefined;
          const effectiveMode =
            parentMode && parentMode !== "ask"
              ? parentMode
              : (effectiveAgent.mode ?? "ask");
          const resumed = await startSubagent({
            agentDir,
            id,
            agent: effectiveAgent.name,
            task: state.task,
            depth: state.depth,
            attempt: state.attempt + 1,
            ...(state.parentSession !== undefined
              ? { parentSession: state.parentSession }
              : {}),
            command: spec.command,
            args: spec.args,
            cwd: ctx.cwd,
            harness: spec.harness,
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
          });
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
              throw error;
            }
          }
          return textResult(stateWithLog(agentDir, resumed));
        }
        return errorResult(`invalid action: ${String(action)}`);
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  });
}
