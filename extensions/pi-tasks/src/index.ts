import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { reconcileAllTasks } from "./runner.js";
import { createTaskTool } from "./task-tool.js";

export * from "./registry.js";
export * from "./runner.js";
export * from "./task-tool.js";

function updateTasksStatus(ctx: ExtensionContext, runningCount: number): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus(
    "tasks",
    runningCount > 0 ? `${runningCount} running` : undefined,
  );
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
      onStatusChange: updateTasksStatus,
      onTasksChange: (tasks) => {
        pi.events?.emit?.("tasks:state", tasks);
      },
    }),
  );

  pi.on("session_start", (_event, ctx) => {
    const all = emitTasksState(getAgentDir());
    let runningCount = 0;
    for (const t of all) {
      if (t.status === "running") runningCount++;
    }
    updateTasksStatus(ctx, runningCount);
  });

  pi.on("session_shutdown", () => {
    // Durable shell tasks intentionally survive session shutdown.
  });
}
