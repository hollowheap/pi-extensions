import {
  type Workspace,
  type WorkspaceOperations,
  allocateWorkspace,
  cleanupWorkspace,
  integrateWorkspace,
} from "@hollowheap/core";

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

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export class SubagentWorkspaceTracker {
  private readonly workspaces = new Map<string, Workspace>();

  constructor(
    private readonly cleanup: (
      workspace: Workspace,
    ) => Promise<void> = cleanupSubagentWorkspace,
  ) {}

  track(id: string, workspace: Workspace): void {
    if (workspace.isolated) this.workspaces.set(id, workspace);
  }

  async cleanupTerminal(
    states: readonly SubagentWorkspaceState[],
  ): Promise<void> {
    for (const state of states) {
      if (!TERMINAL.has(state.status)) continue;
      const workspace = this.workspaces.get(state.id);
      if (workspace === undefined) continue;
      this.workspaces.delete(state.id);
      try {
        await this.cleanup(workspace);
      } catch {
        // A failed cleanup must not affect subagent state.
      }
    }
  }
}

export const subagentWorkspaceTracker = new SubagentWorkspaceTracker();
