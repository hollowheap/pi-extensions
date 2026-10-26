import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, getAgentDir } from "@earendil-works/pi-coding-agent";
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
    "--append-system-prompt",
    agent.systemPrompt,
    "--session",
    sessionPath,
  ];
  if (agent.model !== undefined) args.push("--model", agent.model);
  if (agent.thinking !== undefined) args.push("--thinking", agent.thinking);
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
          const id = generateSubagentId();
          const sessionPath = join(
            agentDir,
            "subagents",
            `${id}.session.jsonl`,
          );
          const spec = deps.childSpec(agent, sessionPath);
          const state = await deps.start({
            agentDir,
            id,
            agent: agent.name,
            task,
            depth,
            command: spec.command,
            args: spec.args,
            cwd: ctx.cwd,
            env: {
              PI_SUBAGENT_DEPTH: String(depth),
            },
            ...(agent.model !== undefined ? { model: agent.model } : {}),
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
          const spec = deps.childSpec(agent, sessionPath);
          const resumed = await deps.start({
            agentDir,
            id,
            agent: agent.name,
            task: state.task,
            depth: state.depth,
            attempt: state.attempt + 1,
            command: spec.command,
            args: spec.args,
            cwd: ctx.cwd,
            env: { PI_SUBAGENT_DEPTH: String(state.depth) },
            ...(agent.model !== undefined ? { model: agent.model } : {}),
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
