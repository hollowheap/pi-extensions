import { describe, expect, it, vi } from "vitest";
import {
  TaskWorkspaceTracker,
  allocateTaskWorkspace,
  cleanupTaskWorkspace,
  integrateTaskWorkspace,
} from "./workspace.js";

describe("task workspace", () => {
  it("keeps the shared root unless explicitly enabled", async () => {
    const makeDirectory = vi.fn(async () => {});
    const workspace = await allocateTaskWorkspace(
      { root: "C:\\repo", id: "task-1" },
      { makeDirectory },
    );

    expect(workspace).toEqual({ path: "C:\\repo", isolated: false });
    expect(makeDirectory).not.toHaveBeenCalled();
  });

  it("allocates and cleans up an isolated task workspace", async () => {
    const makeDirectory = vi.fn(async () => {});
    const removeDirectory = vi.fn(async () => {});
    const workspace = await allocateTaskWorkspace(
      { root: "C:\\repo", id: "task-1", enabled: true },
      { makeDirectory },
    );

    await cleanupTaskWorkspace(workspace, { removeDirectory });

    expect(workspace.isolated).toBe(true);
    expect(makeDirectory).toHaveBeenCalledWith(workspace.path);
    expect(removeDirectory).toHaveBeenCalledWith(workspace.path);
  });

  it("requires explicit integration for isolated tasks", async () => {
    const integrate = vi.fn();
    const workspace = { path: "C:\\repo\\isolated", isolated: true };

    await integrateTaskWorkspace(workspace, integrate);
    expect(integrate).toHaveBeenCalledWith("C:\\repo\\isolated");
    await expect(
      integrateTaskWorkspace({ path: "C:\\repo", isolated: false }, integrate),
    ).rejects.toThrow(/not isolated/);
  });
});

describe("task workspace tracker", () => {
  it("cleans only terminal isolated workspaces", async () => {
    const cleanup = vi.fn(async () => {});
    const tracker = new TaskWorkspaceTracker(cleanup);
    tracker.track("task-1", { path: "/repo/isolated", isolated: true });
    tracker.track("task-2", { path: "/repo/shared", isolated: false });

    await tracker.cleanupTerminal([
      { id: "task-1", status: "running" },
      { id: "task-2", status: "completed" },
    ]);
    expect(cleanup).not.toHaveBeenCalled();

    await tracker.cleanupTerminal([{ id: "task-1", status: "completed" }]);
    expect(cleanup).toHaveBeenCalledWith({
      path: "/repo/isolated",
      isolated: true,
    });
  });
});
