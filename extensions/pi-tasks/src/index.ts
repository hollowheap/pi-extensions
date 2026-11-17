import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { isPermissionError } from "@hollowheap/core/config";
import { sanitizeTerminalText } from "@hollowheap/core/format";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { taskAlertTracker } from "./alerts.js";
import {
  type TasksSettings,
  loadTasksConfig,
  saveTasksSettings,
} from "./config.js";
import { type TaskRecord, readTaskLog, taskLogPath } from "./registry.js";
import { reconcileAllTasks } from "./runner.js";
import { createTaskTool } from "./task-tool.js";
import { rehydrateTaskWorkspaces, taskWorkspaceTracker } from "./workspace.js";

export * from "@hollowheap/runtime/lifecycle";
export * from "./config.js";
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

  let lastRunningCount = 0;
  let lastContext: ExtensionContext | undefined;

  const syncTasksSnapshot = (
    sessionManager: unknown,
    allTasks: TaskRecord[],
  ): void => {
    if (!sessionManager) return;
    const running = allTasks.filter((t) => t.status === "running").length;
    const total = allTasks.length;
    const recent = allTasks
      .slice()
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 5)
      .map((t) => ({
        id: t.id,
        status: t.status,
        command: t.command ? sanitizeTerminalText(t.command) : t.command,
        startedAt: t.startedAt,
        exitCode: t.exitCode,
      }));
    updateSessionSnapshot(sessionManager, "tasks", {
      running,
      total,
      recent,
      updatedAt: Date.now(),
    });
  };

  const publishStatusline = (runningCount: number, ctx?: ExtensionContext) => {
    lastRunningCount = runningCount;
    if (ctx) lastContext = ctx;
    pi.events?.emit?.("statusline:values", {
      name: "tasks",
      text: runningCount > 0 ? `${runningCount} running` : "",
    });
    const effectiveCtx = ctx ?? lastContext;
    if (effectiveCtx?.sessionManager) {
      try {
        const all = reconcileAllTasks(getAgentDir());
        syncTasksSnapshot(effectiveCtx.sessionManager, all);
      } catch {
        // Snapshot sync must not break statusline
      }
    }
  };

  pi.events?.on?.("statusline:request", (data: unknown) => {
    if (typeof data === "object" && data !== null) {
      const names = (data as { names?: unknown }).names;
      if (Array.isArray(names) && !names.includes("tasks")) return;
    }
    publishStatusline(lastRunningCount);
  });

  const emitTasksState = (agentDir: string) => {
    const all = reconcileAllTasks(agentDir);
    const running = all
      .filter((t) => t.status === "running")
      .map((t) => ({ id: t.id, command: t.command, status: t.status }));
    pi.events?.emit?.("tasks:state", running);
    if (lastContext?.sessionManager) {
      syncTasksSnapshot(lastContext.sessionManager, all);
    }
    return all;
  };

  pi.registerTool(
    createTaskTool({
      getAgentDir,
      pi,
      onStatusChange: (ctx, runningCount) => {
        lastContext = ctx;
        updateTasksStatus(ctx, runningCount);
        publishStatusline(runningCount, ctx);
      },
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
        let runningCount = 0;
        for (const t of tasks) {
          if (t.status === "running") runningCount++;
        }
        if (runningCount !== lastRunningCount) {
          publishStatusline(runningCount);
          if (lastContext) {
            updateTasksStatus(lastContext, runningCount);
          }
        }
      } catch {
        // Alert and cleanup observation must not affect tasks.
      }
    }, 1000);
    alertTicker.unref?.();
  };

  pi.registerCommand("task", {
    description: "Task management: /task [logs] [id] | /task settings|config",
    getArgumentCompletions: (prefix: string) => {
      const parts = prefix.trimStart().split(/\s+/);
      if (parts.length === 1) {
        const actions = [
          { value: "logs", label: "logs", description: "show task log" },
          {
            value: "settings",
            label: "settings",
            description: "configure task sandbox settings",
          },
          {
            value: "config",
            label: "config",
            description: "configure task sandbox settings",
          },
        ];
        const query = (parts[0] ?? "").toLowerCase();
        return actions.filter((action) => action.value.startsWith(query));
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
      const subcommand = (parts[0] ?? "").toLowerCase();
      if (subcommand === "settings" || subcommand === "config") {
        const agentDir = getAgentDir();
        const config = loadTasksConfig(agentDir);
        if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
          if (ctx.hasUI) {
            for (const diagnostic of config.diagnostics) {
              ctx.ui.notify(
                `pi-tasks: ${diagnostic}`,
                isPermissionError(diagnostic) ? "error" : "warning",
              );
            }
            ctx.ui.notify(
              `Task settings require TUI mode; edit ${config.path}`,
              "info",
            );
          }
          return;
        }
        for (const diagnostic of config.diagnostics) {
          ctx.ui.notify(
            `pi-tasks: ${diagnostic}`,
            isPermissionError(diagnostic) ? "error" : "warning",
          );
        }
        let saved = false;
        const { showTasksSettings } = await import("./settings.js");
        await showTasksSettings(ctx, config, (settings: TasksSettings) => {
          try {
            saveTasksSettings(agentDir, settings);
            saved = true;
          } catch (error) {
            ctx.ui.notify(
              `pi-tasks: failed to save settings: ${error instanceof Error ? error.message : String(error)}`,
              "error",
            );
          }
        });
        if (saved) ctx.ui.notify("Tasks settings saved", "info");
        return;
      }
      if (parts.length === 0 || (subcommand === "logs" && !parts[1])) {
        const id = await pickTask(ctx);
        if (id !== undefined) await openTaskLog(ctx, id);
        return;
      }
      if (subcommand === "logs" && parts[1]) {
        await openTaskLog(ctx, parts[1]);
        return;
      }
      if (ctx.hasUI) {
        ctx.ui.notify(
          "Usage: /task [logs] [id] | /task settings|config",
          "info",
        );
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    lastContext = ctx;
    try {
      const all = emitTasksState(getAgentDir());
      rehydrateTaskWorkspaces(taskWorkspaceTracker, all);
      for (const t of all) taskAlertTracker.seed(t);
      let runningCount = 0;
      for (const t of all) {
        if (t.status === "running") runningCount++;
      }
      updateTasksStatus(ctx, runningCount);
      publishStatusline(runningCount, ctx);
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
