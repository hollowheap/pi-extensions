import { mkdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface Workspace {
  path: string;
  isolated: boolean;
}

export interface WorkspaceOptions {
  enabled?: boolean;
}

export interface WorkspaceOperations {
  makeDirectory?: (path: string) => Promise<void>;
  removeDirectory?: (path: string) => Promise<void>;
}

function safeId(id: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id === "." || id === "..") {
    throw new Error(`invalid workspace id: ${id}`);
  }
  return id;
}

export function workspacePath(root: string, id: string): string {
  return join(root, ".pi-workspaces", safeId(id));
}

export async function allocateWorkspace(
  root: string,
  id: string,
  options: WorkspaceOptions = {},
  operations: WorkspaceOperations = {},
): Promise<Workspace> {
  if (options.enabled !== true) {
    return { path: root, isolated: false };
  }
  const path = workspacePath(root, id);
  const makeDirectory =
    operations.makeDirectory ??
    ((value) => mkdir(value, { recursive: true }).then(() => {}));
  await makeDirectory(path);
  return { path, isolated: true };
}

export async function cleanupWorkspace(
  workspace: Workspace,
  operations: WorkspaceOperations = {},
): Promise<void> {
  if (!workspace.isolated) return;
  const removeDirectory =
    operations.removeDirectory ??
    ((value) => rm(value, { recursive: true, force: true }));
  await removeDirectory(workspace.path);
}

export async function integrateWorkspace(
  workspace: Workspace,
  integrate: (path: string) => void | Promise<void>,
): Promise<void> {
  if (!workspace.isolated) {
    throw new Error("workspace is not isolated");
  }
  await integrate(workspace.path);
}

const DEFAULT_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export interface WorkspaceTrackerOptions {
  cleanup?: (workspace: Workspace) => Promise<void>;
  terminalStatuses?: Iterable<string>;
}

export function isWorkspacePath(path: string | undefined, id: string): boolean {
  if (typeof path !== "string" || path === "" || id === "") return false;
  try {
    return (
      safeId(id) === basename(path) &&
      basename(dirname(path)) === ".pi-workspaces"
    );
  } catch {
    return false;
  }
}

export class WorkspaceTracker<
  T extends { id: string; status: string; cwd?: string } = {
    id: string;
    status: string;
    cwd?: string;
  },
> {
  private readonly workspaces = new Map<string, Workspace>();
  private readonly cleanup: (workspace: Workspace) => Promise<void>;
  private readonly terminalStatuses: ReadonlySet<string>;

  constructor(
    cleanupOrOptions?:
      | ((workspace: Workspace) => Promise<void>)
      | WorkspaceTrackerOptions,
  ) {
    const options =
      typeof cleanupOrOptions === "function"
        ? { cleanup: cleanupOrOptions }
        : (cleanupOrOptions ?? {});
    this.cleanup =
      options.cleanup ?? ((workspace) => cleanupWorkspace(workspace));
    this.terminalStatuses =
      options.terminalStatuses === undefined
        ? DEFAULT_TERMINAL_STATUSES
        : options.terminalStatuses instanceof Set
          ? options.terminalStatuses
          : new Set(options.terminalStatuses);
  }

  track(id: string, workspace: Workspace): void {
    if (workspace.isolated) this.workspaces.set(id, workspace);
  }

  async cleanupTerminal(
    items: readonly T[],
    onCleaned?: (id: string) => void,
  ): Promise<void> {
    for (const item of items) {
      if (!this.terminalStatuses.has(item.status)) continue;
      const workspace = this.workspaces.get(item.id);
      if (workspace === undefined) continue;
      this.workspaces.delete(item.id);
      try {
        await this.cleanup(workspace);
        onCleaned?.(item.id);
      } catch {
        // A failed cleanup must not affect caller state.
      }
    }
  }

  rehydrate(items: readonly T[]): void {
    for (const item of items) {
      if (item.cwd === undefined || !isWorkspacePath(item.cwd, item.id)) {
        continue;
      }
      this.track(item.id, { path: item.cwd, isolated: true });
    }
  }
}
