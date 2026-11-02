import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

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
