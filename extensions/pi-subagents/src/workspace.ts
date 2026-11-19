import {
  type Workspace,
  type WorkspaceOperations,
  WorkspaceTracker,
  allocateWorkspace,
  cleanupWorkspace,
  integrateWorkspace,
} from "@hollowheap/core/workspace";

export interface SubagentWorkspaceOptions {
  root: string;
  id: string;
  enabled?: boolean;
}

export function allocateSubagentWorkspace(
  options: SubagentWorkspaceOptions,
  operations?: WorkspaceOperations,
): Promise<Workspace> {
  return allocateWorkspace(
    options.root,
    options.id,
    { enabled: options.enabled },
    operations,
  );
}

export function cleanupSubagentWorkspace(
  workspace: Workspace,
  operations?: WorkspaceOperations,
): Promise<void> {
  return cleanupWorkspace(workspace, operations);
}

export function integrateSubagentWorkspace(
  workspace: Workspace,
  integrate: (path: string) => void | Promise<void>,
): Promise<void> {
  return integrateWorkspace(workspace, integrate);
}

export interface SubagentWorkspaceState {
  id: string;
  status: string;
}

export class SubagentWorkspaceTracker extends WorkspaceTracker<SubagentWorkspaceState> {
  constructor(
    cleanup: (workspace: Workspace) => Promise<void> = cleanupSubagentWorkspace,
  ) {
    super({ cleanup });
  }
}

export const subagentWorkspaceTracker = new SubagentWorkspaceTracker();
