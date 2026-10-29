import { Type } from "@earendil-works/pi-ai";
import {
  type ExtensionContext,
  defineTool,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  displayTarget,
  effectiveCwd,
  evaluate,
  loadPermissions,
  truncateText,
} from "@hollowheap/core";
import { type TaskRecord, taskLogPath } from "./registry.js";
import {
  cancelTask,
  reconcileAllTasks,
  reconcileTask,
  spawnShellTask,
  waitForTask,
} from "./runner.js";

export type TaskAction = "start" | "list" | "status" | "wait" | "cancel";

export interface TaskToolParams {
  action: TaskAction;
  command?: string;
  id?: string;
  timeoutMs?: number;
  dependsOn?: string[];
}

export interface TaskToolDeps {
  getAgentDir?: () => string;
  onStatusChange?: (ctx: ExtensionContext, runningCount: number) => void;
  onTasksChange?: (
    tasks: Array<{ id: string; command?: string; status: string }>,
  ) => void;
}

interface TaskToolDetails {
  action: string;
  id?: string;
  status?: string;
  runningCount: number;
}

function textResult(text: string, details: TaskToolDetails) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function countRunning(tasks: readonly TaskRecord[]): number {
  let count = 0;
  for (const t of tasks) {
    if (t.status === "running") count++;
  }
  return count;
}

function formatTaskDetail(
  agentDir: string,
  record: TaskRecord,
  output: string,
): string {
  const lines = [
    `id: ${record.id}`,
    `kind: ${record.kind}`,
    `status: ${record.status}`,
    `cwd: ${record.cwd}`,
    ...(record.command !== undefined ? [`command: ${record.command}`] : []),
    ...(record.pid !== undefined ? [`pid: ${record.pid}`] : []),
    ...(record.exitCode !== undefined
      ? [`exitCode: ${String(record.exitCode)}`]
      : []),
    `startedAt: ${new Date(record.startedAt).toISOString()}`,
    ...(record.finishedAt !== undefined
      ? [`finishedAt: ${new Date(record.finishedAt).toISOString()}`]
      : []),
    `log: ${taskLogPath(agentDir, record.id)}`,
  ];
  const trimmedOutput =
    output.trim() === "" ? "(no output)" : truncateText(output, "pi-tasks");
  lines.push("", "--- output ---", trimmedOutput);
  return lines.join("\n");
}

function formatTaskList(tasks: readonly TaskRecord[]): string {
  if (tasks.length === 0) return "No tasks found.";
  return tasks
    .map((t) => {
      const exitStr =
        t.exitCode !== undefined && t.exitCode !== null
          ? ` (exit ${t.exitCode})`
          : "";
      const cmdStr = t.command ? ` — ${t.command}` : "";
      return `${t.id} [${t.kind}] ${t.status}${exitStr}${cmdStr}`;
    })
    .join("\n");
}

export function createTaskTool(deps: TaskToolDeps = {}) {
  const resolveAgentDir = deps.getAgentDir ?? getAgentDir;

  return defineTool({
    name: "task",
    label: "Background Tasks",
    description:
      "Start and manage durable background shell tasks (start, list, status, wait, cancel).",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("start"),
        Type.Literal("list"),
        Type.Literal("status"),
        Type.Literal("wait"),
        Type.Literal("cancel"),
      ]),
      command: Type.Optional(
        Type.String({
          description:
            "Shell command to run in the background (required for start)",
        }),
      ),
      id: Type.Optional(
        Type.String({
          description: "Task ID (required for status, wait, and cancel)",
        }),
      ),
      timeoutMs: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 600_000,
          default: 30_000,
          description: "Maximum milliseconds to wait (for wait action)",
        }),
      ),
      dependsOn: Type.Optional(
        Type.Array(Type.String(), {
          description: "Task IDs that must complete before this task starts",
        }),
      ),
    }),
    async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
      const params = (rawParams ?? {}) as TaskToolParams;
      const action = params.action;
      const agentDir = resolveAgentDir();

      const refreshRunningCount = (): number => {
        const all = reconcileAllTasks(agentDir);
        const running = countRunning(all);
        deps.onStatusChange?.(ctx, running);
        deps.onTasksChange?.(
          all
            .filter((t) => t.status === "running")
            .map((t) => ({ id: t.id, command: t.command, status: t.status })),
        );
        return running;
      };

      if (
        action !== "start" &&
        action !== "list" &&
        action !== "status" &&
        action !== "wait" &&
        action !== "cancel"
      ) {
        const runningCount = refreshRunningCount();
        return textResult(
          `Invalid task action: ${String(action)}. Expected start, list, status, wait, or cancel.`,
          { action: String(action), runningCount },
        );
      }

      if (action === "start") {
        if (!ctx.isProjectTrusted()) {
          const runningCount = refreshRunningCount();
          return textResult(
            "task start requires a trusted project; durable background tasks survive the session.",
            { action, runningCount },
          );
        }
        const command =
          typeof params.command === "string" ? params.command.trim() : "";
        if (command === "") {
          const runningCount = refreshRunningCount();
          return textResult("task start requires a command.", {
            action,
            runningCount,
          });
        }

        const rules = loadPermissions({
          agentDir,
          workspaceRoot: ctx.cwd,
          trusted: ctx.isProjectTrusted(),
          onDiagnostic: (message) =>
            ctx.ui.notify(`pi-tasks: ${message}`, "warning"),
        });
        const verdict = evaluate({
          owner: ctx.sessionManager,
          cwd: ctx.cwd,
          tag: "shell",
          target: command,
          rules,
        });
        if (verdict === "deny") {
          const runningCount = refreshRunningCount();
          return textResult(
            `pi-tasks: shell access to ${displayTarget(command)} is denied`,
            { action, runningCount },
          );
        }

        // Check dependencies
        const deps = Array.isArray(params.dependsOn) ? params.dependsOn : [];
        if (deps.length > 0) {
          // Check for circular dependencies
          const allTasks = reconcileAllTasks(agentDir);
          const taskMap = new Map(allTasks.map((t) => [t.id, t]));
          for (const dep of deps) {
            if (!taskMap.has(dep)) {
              const runningCount = refreshRunningCount();
              return textResult(`Dependency not found: ${dep}`, {
                action,
                runningCount,
              });
            }
          }
          // Check if any dep is still running
          const pendingDeps = deps.filter((dep) => {
            const t = taskMap.get(dep);
            return t && t.status === "running";
          });
          if (pendingDeps.length > 0) {
            const runningCount = refreshRunningCount();
            return textResult(
              `Waiting for dependencies: ${pendingDeps.join(", ")}`,
              { action, runningCount },
            );
          }
          // Check if any dep failed
          const failedDeps = deps.filter((dep) => {
            const t = taskMap.get(dep);
            return t && t.status === "failed";
          });
          if (failedDeps.length > 0) {
            const runningCount = refreshRunningCount();
            return textResult(`Dependencies failed: ${failedDeps.join(", ")}`, {
              action,
              runningCount,
            });
          }
        }

        const cwd = effectiveCwd(ctx.cwd, ctx.sessionManager);
        const record = await spawnShellTask({
          agentDir,
          command,
          cwd,
          dependsOn: deps.length > 0 ? deps : undefined,
        });
        const runningCount = refreshRunningCount();
        const log = taskLogPath(agentDir, record.id);
        return textResult(
          `Started task ${record.id} (pid: ${record.pid ?? "unknown"})\nlog: ${log}`,
          {
            action,
            id: record.id,
            status: record.status,
            runningCount,
          },
        );
      }

      if (action === "list") {
        const all = reconcileAllTasks(agentDir);
        const runningCount = countRunning(all);
        deps.onStatusChange?.(ctx, runningCount);
        return textResult(formatTaskList(all), {
          action,
          runningCount,
        });
      }

      const id = typeof params.id === "string" ? params.id.trim() : "";
      if (id === "") {
        const runningCount = refreshRunningCount();
        return textResult(`task ${action} requires an id.`, {
          action,
          runningCount,
        });
      }

      if (action === "status") {
        const record = reconcileTask(agentDir, id);
        const runningCount = refreshRunningCount();
        if (!record) {
          return textResult(`Task not found: ${id}`, {
            action,
            id,
            runningCount,
          });
        }
        const out = await record.output();
        return textResult(formatTaskDetail(agentDir, record, out), {
          action,
          id: record.id,
          status: record.status,
          runningCount,
        });
      }

      if (action === "wait") {
        const timeoutMs =
          typeof params.timeoutMs === "number" &&
          Number.isFinite(params.timeoutMs)
            ? params.timeoutMs
            : 30_000;
        const record = await waitForTask(agentDir, id, timeoutMs, signal);
        const runningCount = refreshRunningCount();
        if (!record) {
          return textResult(`Task not found: ${id}`, {
            action,
            id,
            runningCount,
          });
        }
        const out = await record.output();
        return textResult(formatTaskDetail(agentDir, record, out), {
          action,
          id: record.id,
          status: record.status,
          runningCount,
        });
      }

      const record = await cancelTask(agentDir, id);
      const runningCount = refreshRunningCount();
      if (!record) {
        return textResult(`Task not found: ${id}`, {
          action,
          id,
          runningCount,
        });
      }
      const out = await record.output();
      return textResult(formatTaskDetail(agentDir, record, out), {
        action,
        id: record.id,
        status: record.status,
        runningCount,
      });
    },
  });
}
