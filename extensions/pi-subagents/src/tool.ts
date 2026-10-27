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
import { truncateText } from "@hollowheap/core";
import { type AgentConfig, discoverAgents } from "./agents.js";
import { loadSubagentsConfig } from "./config.js";
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

export interface SubagentToolDeps {
  start: typeof startSubagent;
  attach: typeof attachSubagent;
  send: typeof sendSubagent;
  abort: typeof abortSubagent;
  wait: typeof waitSubagent;
  list: typeof listSubagents;
  log: typeof readSubagentLog;
  agents: typeof discoverAgents;
  getAgentDir: () => string;
  childSpec: (
    agent: AgentConfig,
    sessionPath: string,
  ) => { command: string; args: string[] };
  resolveModel?: typeof resolveSubagentModel;
}

const defaultDeps: SubagentToolDeps = {
  start: startSubagent,
  attach: attachSubagent,
  send: sendSubagent,
  abort: abortSubagent,
  wait: waitSubagent,
  list: listSubagents,
  log: readSubagentLog,
  agents: discoverAgents,
  getAgentDir,
  childSpec,
  resolveModel: resolveSubagentModel,
};

function childSpec(
  agent: AgentConfig,
  sessionPath: string,
): { command: string; args: string[] } {
  const require = createRequire(import.meta.url);
  let guardDir: string;
  try {
    guardDir = dirname(require.resolve("@hollowheap/pi-guard/package.json"));
  } catch {
    throw new Error("pi-guard is required to run subagents");
  }
  const args = [
    "--mode",
    "rpc",
    "--no-themes",
    "-ne",
    "-e",
    join(guardDir, "index.ts"),
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
  return { command: process.env.PI_BIN ?? "pi", args };
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
  };
}

function stateWithLog(
  deps: SubagentToolDeps,
  agentDir: string,
  state: SubagentState,
): Record<string, unknown> {
  const log = deps.log(agentDir, state.id);
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

export function createSubagentTool(overrides: Partial<SubagentToolDeps> = {}) {
  const deps: SubagentToolDeps = { ...defaultDeps, ...overrides };
  return defineTool({
    name: "subagent",
    label: "subagent",
    description:
      "Start and manage one durable child agent (start, list, status, send, wait, cancel).",
    exposure: "direct",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("start"),
        Type.Literal("list"),
        Type.Literal("status"),
        Type.Literal("send"),
        Type.Literal("wait"),
        Type.Literal("cancel"),
        Type.Literal("resume"),
      ]),
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
    }),
    renderCall(args, theme, context) {
      const text =
        context?.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      const action = args?.action ?? "subagent";
      let line = `${theme.fg("toolTitle", theme.bold("subagent"))} ${theme.fg("accent", action)}`;
      if (action === "start") {
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
    async execute(_toolCallId, raw, _signal, _onUpdate, ctx) {
      const params = (raw ?? {}) as {
        action?: string;
        agent?: string;
        task?: string;
        id?: string;
        message?: string;
        mode?: "steer" | "prompt" | "follow_up";
        timeoutMs?: number;
      };
      const agentDir = deps.getAgentDir();
      const action = params.action;
      try {
        if (action === "list") {
          return textResult({
            agents: deps.list(agentDir).map(summary),
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
          const running = deps
            .list(agentDir)
            .filter(
              (state) =>
                state.status === "running" || state.status === "starting",
            ).length;
          if (running >= config.maxConcurrent) {
            return errorResult(`maxConcurrent ${config.maxConcurrent} reached`);
          }
          const discovery = deps.agents({
            cwd: ctx.cwd,
            agentDir,
            trusted: true,
          });
          const agent = discovery.agents.find((item) => item.name === name);
          if (agent === undefined) {
            return errorResult(
              `unknown agent "${name}"; available: ${
                discovery.agents.map((item) => item.name).join(", ") || "none"
              }`,
            );
          }
          const resolvedModel = await (
            deps.resolveModel ?? resolveSubagentModel
          )(agent, ctx);
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
          const spec = deps.childSpec(effectiveAgent, sessionPath);
          const state = await deps.start({
            agentDir,
            id,
            agent: effectiveAgent.name,
            task,
            depth,
            command: spec.command,
            args: spec.args,
            cwd: ctx.cwd,
            env: {
              PI_SUBAGENT_DEPTH: String(depth),
            },
            ...(effectiveAgent.model !== undefined
              ? { model: effectiveAgent.model }
              : {}),
            sessionPath,
          });
          try {
            await deps.send(agentDir, state.id, {
              id: Math.floor(Math.random() * 1_000_000_000),
              type: "prompt",
              message: task,
            });
          } catch (error) {
            await deps.abort(agentDir, state.id).catch(() => {});
            throw error;
          }
          return textResult(stateWithLog(deps, agentDir, state));
        }

        const id = params.id?.trim() ?? "";
        if (id === "") return errorResult(`${String(action)} requires id`);
        if (action === "status") {
          const state = await deps.attach(agentDir, id);
          if (state === undefined) return errorResult(`unknown id: ${id}`);
          return textResult(stateWithLog(deps, agentDir, state));
        }
        if (action === "send") {
          const message = params.message?.trim() ?? "";
          if (message === "") return errorResult("send requires message");
          const mode = params.mode ?? "steer";
          await deps.send(agentDir, id, {
            id: Math.floor(Math.random() * 1_000_000_000),
            type: mode,
            message,
          });
          return textResult({ id, mode });
        }
        if (action === "wait") {
          const timeoutMs = Math.min(params.timeoutMs ?? 30_000, 600_000);
          const state = await deps.wait(agentDir, id, timeoutMs);
          if (state === undefined) return errorResult(`unknown id: ${id}`);
          return textResult(stateWithLog(deps, agentDir, state));
        }
        if (action === "cancel") {
          await deps.abort(agentDir, id);
          const state = await deps.wait(agentDir, id, 1_000);
          if (state === undefined) return errorResult(`unknown id: ${id}`);
          return textResult(stateWithLog(deps, agentDir, state));
        }
        if (action === "resume") {
          if (!ctx.isProjectTrusted()) {
            return errorResult("resume requires a trusted project");
          }
          const state = await deps.attach(agentDir, id);
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
          const running = deps
            .list(agentDir)
            .filter(
              (item) => item.status === "running" || item.status === "starting",
            ).length;
          if (running >= config.maxConcurrent) {
            return errorResult(`maxConcurrent ${config.maxConcurrent} reached`);
          }
          const discovery = deps.agents({
            cwd: ctx.cwd,
            agentDir,
            trusted: true,
          });
          const agent = discovery.agents.find(
            (item) => item.name === state.agent,
          );
          if (agent === undefined) {
            return errorResult(
              `unknown agent "${state.agent}"; available: ${
                discovery.agents.map((item) => item.name).join(", ") || "none"
              }`,
            );
          }
          const sessionPath =
            state.session ?? join(agentDir, "subagents", `${id}.session.jsonl`);
          const modelToUse = state.model ?? agent.model;
          const resolvedModel = await (
            deps.resolveModel ?? resolveSubagentModel
          )({ ...agent, model: modelToUse }, ctx);
          const effectiveAgent =
            resolvedModel !== undefined
              ? { ...agent, model: resolvedModel }
              : agent;
          const spec = deps.childSpec(effectiveAgent, sessionPath);
          const resumed = await deps.start({
            agentDir,
            id,
            agent: effectiveAgent.name,
            task: state.task,
            depth: state.depth,
            attempt: state.attempt + 1,
            command: spec.command,
            args: spec.args,
            cwd: ctx.cwd,
            env: { PI_SUBAGENT_DEPTH: String(state.depth) },
            ...(effectiveAgent.model !== undefined
              ? { model: effectiveAgent.model }
              : {}),
            sessionPath,
          });
          try {
            await deps.send(agentDir, id, {
              id: Math.floor(Math.random() * 1_000_000_000),
              type: "prompt",
              message: state.task,
            });
          } catch (error) {
            await deps.abort(agentDir, id).catch(() => {});
            throw error;
          }
          return textResult(stateWithLog(deps, agentDir, resumed));
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
