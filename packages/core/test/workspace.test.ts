import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceTracker,
  allocateWorkspace,
  cleanupWorkspace,
  integrateWorkspace,
  isWorkspacePath,
  workspacePath,
} from "../src/workspace.js";

describe("workspace isolation", () => {
  it("keeps the shared root when isolation is not enabled", async () => {
    const makeDirectory = vi.fn(async () => {});
    const workspace = await allocateWorkspace(
      "C:\\repo",
      "task-1",
      {},
      {
        makeDirectory,
      },
    );

    expect(workspace).toEqual({ path: "C:\\repo", isolated: false });
    expect(makeDirectory).not.toHaveBeenCalled();
  });

  it("allocates a separate workspace only when enabled", async () => {
    const makeDirectory = vi.fn(async () => {});
    const workspace = await allocateWorkspace(
      "C:\\repo",
      "task-1",
      { enabled: true },
      { makeDirectory },
    );

    expect(workspace.isolated).toBe(true);
    expect(workspace.path).toContain("task-1");
    expect(makeDirectory).toHaveBeenCalledWith(workspace.path);
  });

  it("rejects path traversal in workspace ids", () => {
    expect(() => workspacePath("C:\\repo", "../escape")).toThrow(
      /invalid workspace id/,
    );
  });

  it("cleans up isolated workspaces only", async () => {
    const removeDirectory = vi.fn(async () => {});
    await cleanupWorkspace(
      { path: "C:\\repo", isolated: false },
      {
        removeDirectory,
      },
    );
    await cleanupWorkspace(
      { path: "C:\\repo\\isolated", isolated: true },
      {
        removeDirectory,
      },
    );

    expect(removeDirectory).toHaveBeenCalledOnce();
    expect(removeDirectory).toHaveBeenCalledWith("C:\\repo\\isolated");
  });

  it("requires an explicit integration callback", async () => {
    const integrate = vi.fn();
    await integrateWorkspace(
      { path: "C:\\repo\\isolated", isolated: true },
      integrate,
    );
    expect(integrate).toHaveBeenCalledWith("C:\\repo\\isolated");
    await expect(
      integrateWorkspace({ path: "C:\\repo", isolated: false }, integrate),
    ).rejects.toThrow(/not isolated/);
  });
});

describe("isWorkspacePath and WorkspaceTracker", () => {
  it("recognizes isolated workspace paths by id", () => {
    expect(isWorkspacePath("/repo/.pi-workspaces/task-1", "task-1")).toBe(true);
    expect(isWorkspacePath("/repo/.pi-workspaces/task-1", "task-2")).toBe(
      false,
    );
    expect(isWorkspacePath("/repo/other/task-1", "task-1")).toBe(false);
    expect(isWorkspacePath(undefined, "task-1")).toBe(false);
    expect(isWorkspacePath("", "task-1")).toBe(false);
    expect(isWorkspacePath("/repo/.pi-workspaces/task-1", "")).toBe(false);
    expect(isWorkspacePath("/repo/.pi-workspaces/..", "..")).toBe(false);
    expect(isWorkspacePath("/repo/.pi-workspaces/.", ".")).toBe(false);
    expect(isWorkspacePath("/repo/.pi-workspaces/escape", "../escape")).toBe(
      false,
    );
  });

  it("tracks isolated workspaces, cleans up terminal items once, and invokes onCleaned", async () => {
    const cleanup = vi.fn(async () => {});
    const cleaned: string[] = [];
    const tracker = new WorkspaceTracker(cleanup);

    tracker.track("a", { path: "/repo/.pi-workspaces/a", isolated: true });
    tracker.track("b", { path: "/repo", isolated: false });

    await tracker.cleanupTerminal(
      [
        { id: "a", status: "running" },
        { id: "b", status: "completed" },
      ],
      (id) => cleaned.push(id),
    );
    expect(cleanup).not.toHaveBeenCalled();
    expect(cleaned).toEqual([]);

    await tracker.cleanupTerminal([{ id: "a", status: "completed" }], (id) =>
      cleaned.push(id),
    );
    await tracker.cleanupTerminal([{ id: "a", status: "completed" }], (id) =>
      cleaned.push(id),
    );

    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith({
      path: "/repo/.pi-workspaces/a",
      isolated: true,
    });
    expect(cleaned).toEqual(["a"]);
  });

  it("swallows cleanup failures without firing onCleaned or retrying", async () => {
    const cleanup = vi.fn(async () => {
      throw new Error("rm failed");
    });
    const onCleaned = vi.fn();
    const tracker = new WorkspaceTracker({
      cleanup,
      terminalStatuses: ["done"],
    });
    tracker.track("t1", { path: "/repo/.pi-workspaces/t1", isolated: true });

    await expect(
      tracker.cleanupTerminal([{ id: "t1", status: "done" }], onCleaned),
    ).resolves.toBeUndefined();
    await tracker.cleanupTerminal([{ id: "t1", status: "done" }], onCleaned);

    expect(cleanup).toHaveBeenCalledOnce();
    expect(onCleaned).not.toHaveBeenCalled();
  });

  it("rehydrates isolated workspaces from item cwd", async () => {
    const cleanup = vi.fn(async () => {});
    const tracker = new WorkspaceTracker(cleanup);

    tracker.rehydrate([
      { id: "t1", status: "running", cwd: "/repo/.pi-workspaces/t1" },
      { id: "t2", status: "running", cwd: "/repo" },
      { id: "t3", status: "running" },
      { id: "..", status: "running", cwd: "/repo/.pi-workspaces/.." },
    ]);

    await tracker.cleanupTerminal([
      { id: "t1", status: "cancelled" },
      { id: "t2", status: "completed" },
      { id: "t3", status: "failed" },
      { id: "..", status: "completed" },
    ]);

    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith({
      path: "/repo/.pi-workspaces/t1",
      isolated: true,
    });
  });
});
