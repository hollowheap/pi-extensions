import {
  type Workspace,
  type WorkspaceOperations,
  WorkspaceTracker,
  allocateWorkspace,
  cleanupWorkspace,
  integrateWorkspace,
  isWorkspacePath,
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
  cwd?: string;
}

export const isTaskWorkspacePath = isWorkspacePath;

export class TaskWorkspaceTracker extends WorkspaceTracker<TaskWorkspaceState> {
  constructor(
    cleanup: (workspace: Workspace) => Promise<void> = cleanupTaskWorkspace,
  ) {
    super({ cleanup });
  }
}

export function rehydrateTaskWorkspaces(
  tracker: TaskWorkspaceTracker,
  tasks: readonly TaskWorkspaceState[],
): void {
  tracker.rehydrate(tasks);
}

export const taskWorkspaceTracker = new TaskWorkspaceTracker();
