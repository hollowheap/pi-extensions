import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { taskAlertTracker } from "./alerts.js";
import { type TaskRecord, readTaskLog, taskLogPath } from "./registry.js";
import { reconcileAllTasks } from "./runner.js";
import { createTaskTool } from "./task-tool.js";
import { taskWorkspaceTracker } from "./workspace.js";

export * from "@hollowheap/runtime/lifecycle";
export * from "./registry.js";
export * from "./runner.js";
export * from "@hollowheap/runtime/store";
export {
  LockedProcessStore as TaskStore,
  type LockedProcessStoreOptions as TaskStoreOptions,
} from "@hollowheap/runtime/store";
export * from "./task-tool.js";
export * from "./workspace.js";

function updateTasksStatus(ctx: ExtensionContext, runningCount: number): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus(
    "tasks",
    runningCount > 0 ? `${runningCount} running` : undefined,
  );
}

async function openTaskLog(ctx: ExtensionContext, id: string): Promise<void> {
  const log = sanitizeTerminalText(readTaskLog(getAgentDir(), id));
  const safeId = sanitizeTerminalText(id);
  const text = log.trim() === "" ? "(no output)" : log;
  const { showMarkdownPager } = await import("@hollowheap/tui/pager");
  await showMarkdownPager(ctx, {
    title: `Task ${safeId}`,
    markdown: `~~~~text\n${text}\n~~~~`,
    plainText: text,
  });
}

function taskPickerItems(tasks: readonly TaskRecord[]) {
  return tasks.map((task) => {
    const safeId = sanitizeTerminalText(task.id);
    const safeCommand = task.command
      ? sanitizeTerminalText(task.command)
      : undefined;
    const safeCwd = sanitizeTerminalText(task.cwd);
    const exit =
      task.exitCode !== undefined && task.exitCode !== null
        ? ` exit ${task.exitCode}`
        : "";
    return {
      value: task.id,
      label: safeId,
      description: `${task.status}${exit}${safeCommand ? ` — ${safeCommand}` : ""}`,
      preview: [
        `${task.status}${exit}`,
        ...(safeCommand ? [`command: ${safeCommand}`] : []),
        `cwd: ${safeCwd}`,
        `started: ${new Date(task.startedAt).toISOString()}`,
        `log: ${sanitizeTerminalText(taskLogPath(getAgentDir(), task.id))}`,
      ],
    };
  });
}

async function pickTask(ctx: ExtensionContext): Promise<string | undefined> {
  const tasks = reconcileAllTasks(getAgentDir());
  if (tasks.length === 0) {
    if (ctx.hasUI) ctx.ui.notify("No tasks found.", "info");
    return undefined;
  }
  if (ctx.mode === "tui" && typeof ctx.ui.custom === "function") {
    const { showFuzzyPicker } = await import("@hollowheap/tui/picker");
    return showFuzzyPicker(ctx, {
      title: "Select a task",
      items: taskPickerItems(tasks),
      emptyText: "No matching tasks",
    });
  }
  if (ctx.hasUI) {
    ctx.ui.notify(
      tasks.map((task) => `${task.id} [${task.status}]`).join("\n"),
      "info",
    );
  }
  return undefined;
}

export default function (pi: ExtensionAPI) {
  if (process.env.PI_ACP) return;

  const emitTasksState = (agentDir: string) => {
    const all = reconcileAllTasks(agentDir);
    const running = all
      .filter((t) => t.status === "running")
      .map((t) => ({ id: t.id, command: t.command, status: t.status }));
    pi.events?.emit?.("tasks:state", running);
    return all;
  };

  pi.registerTool(
    createTaskTool({
      getAgentDir,
      onStatusChange: updateTasksStatus,
      onTasksChange: (tasks) => {
        pi.events?.emit?.("tasks:state", tasks);
      },
    }),
  );

  let alertTicker: ReturnType<typeof setInterval> | undefined;

  const stopAlertTicker = (): void => {
    if (alertTicker === undefined) return;
    clearInterval(alertTicker);
    alertTicker = undefined;
  };

  const startAlertTicker = (): void => {
    if (alertTicker !== undefined) return;
    alertTicker = setInterval(() => {
      try {
        const tasks = reconcileAllTasks(getAgentDir());
        void taskAlertTracker.observe(tasks);
        void taskWorkspaceTracker.cleanupTerminal(tasks);
      } catch {
        // Alert and cleanup observation must not affect tasks.
      }
    }, 1000);
    alertTicker.unref?.();
  };

  pi.registerCommand("task", {
    description: "Task management: /task [logs] [id]",
    getArgumentCompletions: (prefix: string) => {
      const parts = prefix.trimStart().split(/\s+/);
      if (parts.length === 1) {
        return ["logs"]
          .filter((action) => action.startsWith((parts[0] ?? "").toLowerCase()))
          .map((action) => ({
            value: action,
            label: action,
            description: "show task log",
          }));
      }
      if (parts[0] !== "logs") return null;
      const query = (parts[1] ?? "").toLowerCase();
      return reconcileAllTasks(getAgentDir())
        .filter((task) => task.id.toLowerCase().startsWith(query))
        .map((task) => ({
          value: task.id,
          label: task.id,
          description: `${task.status}${task.command ? ` — ${task.command}` : ""}`,
        }));
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0 || (parts[0] === "logs" && !parts[1])) {
        const id = await pickTask(ctx);
        if (id !== undefined) await openTaskLog(ctx, id);
        return;
      }
      if (parts[0] === "logs" && parts[1]) {
        await openTaskLog(ctx, parts[1]);
        return;
      }
      if (ctx.hasUI) {
        ctx.ui.notify("Usage: /task [logs] [id]", "info");
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    try {
      const all = emitTasksState(getAgentDir());
      for (const t of all) taskAlertTracker.seed(t);
      let runningCount = 0;
      for (const t of all) {
        if (t.status === "running") runningCount++;
      }
      updateTasksStatus(ctx, runningCount);
    } catch (error) {
      if (ctx.hasUI) {
        ctx.ui.notify(
          `pi-tasks: failed to restore task state: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
    }
    startAlertTicker();
  });

  pi.on("session_shutdown", () => {
    stopAlertTicker();
    // Durable shell tasks intentionally survive session shutdown.
  });
}
