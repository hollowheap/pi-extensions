import {
  type Workspace,
  type WorkspaceOperations,
  allocateWorkspace,
  cleanupWorkspace,
  integrateWorkspace,
} from "@hollowheap/core/workspace";

export interface TaskWorkspaceOptions {
  root: string;
  id: string;
  enabled?: boolean;
}

export function allocateTaskWorkspace(
  options: TaskWorkspaceOptions,
  operations?: WorkspaceOperations,
): Promise<Workspace> {
  return allocateWorkspace(
    options.root,
    options.id,
    { enabled: options.enabled },
    operations,
  );
}

export function cleanupTaskWorkspace(
  workspace: Workspace,
  operations?: WorkspaceOperations,
): Promise<void> {
  return cleanupWorkspace(workspace, operations);
}

export function integrateTaskWorkspace(
  workspace: Workspace,
  integrate: (path: string) => void | Promise<void>,
): Promise<void> {
  return integrateWorkspace(workspace, integrate);
}

export interface TaskWorkspaceState {
  id: string;
  status: string;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export class TaskWorkspaceTracker {
  private readonly workspaces = new Map<string, Workspace>();

  constructor(
    private readonly cleanup: (
      workspace: Workspace,
    ) => Promise<void> = cleanupTaskWorkspace,
  ) {}

  track(id: string, workspace: Workspace): void {
    if (workspace.isolated) this.workspaces.set(id, workspace);
  }

  async cleanupTerminal(tasks: readonly TaskWorkspaceState[]): Promise<void> {
    for (const task of tasks) {
      if (!TERMINAL.has(task.status)) continue;
      const workspace = this.workspaces.get(task.id);
      if (workspace === undefined) continue;
      this.workspaces.delete(task.id);
      try {
        await this.cleanup(workspace);
      } catch {
        // A failed cleanup must not affect task state.
      }
    }
  }
}

export const taskWorkspaceTracker = new TaskWorkspaceTracker();
