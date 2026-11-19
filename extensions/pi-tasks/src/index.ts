import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { errorMessage, sanitizeTerminalText } from "@hollowheap/core/format";
import { updateSessionSnapshot } from "@hollowheap/core/snapshot";
import { createStatuslinePublisher } from "@hollowheap/core/statusline";
import { canOverlay, hostUi, notify } from "@hollowheap/pi-ui/host";
import { runSettingsCommand } from "@hollowheap/pi-ui/settings";
import { prefixCompletions } from "@hollowheap/tui/autocomplete";
import { taskAlertTracker } from "./alerts.js";
import { type TaskRecord, readTaskLog, taskLogPath } from "./registry.js";
import { reconcileAllTasks } from "./runner.js";
import {
  type TasksSettings,
  loadTasksConfig,
  saveTasksSettings,
  showTasksSettings,
} from "./settings.js";
import { createTaskTool } from "./task-tool.js";
import { rehydrateTaskWorkspaces, taskWorkspaceTracker } from "./workspace.js";

export * from "@hollowheap/runtime/lifecycle";
export * from "./settings.js";
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
  hostUi(ctx).setStatus(
    "tasks",
    runningCount > 0 ? `${runningCount} running` : undefined,
  );
}

async function openTaskLog(ctx: ExtensionContext, id: string): Promise<void> {
  const log = sanitizeTerminalText(readTaskLog(getAgentDir(), id));
  const safeId = sanitizeTerminalText(id);
  const text = log.trim() === "" ? "(no output)" : log;
  const { showMarkdownPager } = await import("@hollowheap/pi-ui/pager");
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
    if (ctx.hasUI) notify(ctx, "No tasks found.", "info");
    return undefined;
  }
  if (canOverlay(ctx)) {
    const { showFuzzyPicker } = await import("@hollowheap/pi-ui/picker");
    return showFuzzyPicker(ctx, {
      title: "Select a task",
      items: taskPickerItems(tasks),
      emptyText: "No matching tasks",
    });
  }
  if (ctx.hasUI) {
    notify(
      ctx,
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

  const statusline = createStatuslinePublisher(pi.events, "tasks", () => {
    if (lastContext?.sessionManager) {
      try {
        const all = reconcileAllTasks(getAgentDir());
        syncTasksSnapshot(lastContext.sessionManager, all);
      } catch {
        // Snapshot sync must not break statusline
      }
    }
    return lastRunningCount > 0 ? `${lastRunningCount} running` : "";
  });

  const publishStatusline = (runningCount: number, ctx?: ExtensionContext) => {
    lastRunningCount = runningCount;
    if (ctx) lastContext = ctx;
    statusline.publish();
  };

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
        return prefixCompletions(
          parts[0] ?? "",
          [
            ["logs", "show task log"],
            ["settings", "configure task sandbox settings"],
            ["config", "configure task sandbox settings"],
          ] as const,
          ([value, description]) => ({ value, label: value, description }),
        );
      }
      if (parts[0] !== "logs") return null;
      return prefixCompletions(
        parts[1] ?? "",
        reconcileAllTasks(getAgentDir()),
        (task) => ({
          value: task.id,
          label: task.id,
          description: `${task.status}${task.command ? ` — ${sanitizeTerminalText(task.command)}` : ""}`,
        }),
      );
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const subcommand = (parts[0] ?? "").toLowerCase();
      if (subcommand === "settings" || subcommand === "config") {
        const agentDir = getAgentDir();
        const config = loadTasksConfig(agentDir);
        await runSettingsCommand(ctx, {
          prefix: "pi-tasks",
          title: "Task settings",
          configPath: config.path,
          diagnostics: config.diagnostics,
          savedMessage: "Tasks settings saved",
          open: async () => {
            let saved = false;
            await showTasksSettings(ctx, config, (settings: TasksSettings) => {
              try {
                saveTasksSettings(agentDir, settings);
                saved = true;
              } catch (error) {
                saved = false;
                if (ctx.hasUI) {
                  notify(
                    ctx,
                    `pi-tasks: failed to save settings: ${errorMessage(error)}`,
                    "error",
                  );
                }
              }
            });
            return saved;
          },
        });
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
        notify(ctx, "Usage: /task [logs] [id] | /task settings|config", "info");
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
        notify(
          ctx,
          `pi-tasks: failed to restore task state: ${errorMessage(error)}`,
          "warning",
        );
      }
    }
    startAlertTicker();
  });

  pi.on("session_shutdown", () => {
    stopAlertTicker();
    lastRunningCount = 0;
    lastContext = undefined;
    statusline.publish("");
    // Durable shell tasks intentionally survive session shutdown.
  });
}
