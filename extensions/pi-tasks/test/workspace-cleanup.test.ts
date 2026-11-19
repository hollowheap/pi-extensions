import { describe, expect, it, vi } from "vitest";
import { TaskWorkspaceTracker } from "../src/workspace.js";

describe("task workspace cleanup", () => {
  it("cleans a tracked workspace when its task reaches a terminal status", async () => {
    const cleanup = vi.fn(async () => {});
    const tracker = new TaskWorkspaceTracker(cleanup);
    const workspace = { path: "/repo/.pi-workspaces/task-1", isolated: true };
    tracker.track("task-1", workspace);

    await tracker.cleanupTerminal([
      { id: "task-1", status: "running" },
      { id: "task-1", status: "cancelled" },
    ]);

    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith(workspace);
  });

  it("a still-running task leaves its workspace untouched", async () => {
    const cleanup = vi.fn(async () => {});
    const tracker = new TaskWorkspaceTracker(cleanup);
    const workspace = { path: "/repo/.pi-workspaces/task-2", isolated: true };
    tracker.track("task-2", workspace);

    await tracker.cleanupTerminal([{ id: "task-2", status: "running" }]);

    expect(cleanup).not.toHaveBeenCalled();
  });

  it("a cleanup failure is swallowed and the workspace is not retried", async () => {
    const cleanup = vi.fn(async () => {
      throw new Error("rm failed");
    });
    const tracker = new TaskWorkspaceTracker(cleanup);
    tracker.track("task-3", {
      path: "/repo/.pi-workspaces/task-3",
      isolated: true,
    });

    await expect(
      tracker.cleanupTerminal([{ id: "task-3", status: "failed" }]),
    ).resolves.toBeUndefined();
    await tracker.cleanupTerminal([{ id: "task-3", status: "failed" }]);

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("a non-isolated workspace is never tracked for cleanup", async () => {
    const cleanup = vi.fn(async () => {});
    const tracker = new TaskWorkspaceTracker(cleanup);
    tracker.track("task-4", { path: "/repo", isolated: false });

    await tracker.cleanupTerminal([{ id: "task-4", status: "completed" }]);

    expect(cleanup).not.toHaveBeenCalled();
  });
});
