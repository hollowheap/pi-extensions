import { describe, expect, it, vi } from "vitest";
import { TaskWorkspaceTracker } from "./workspace.js";

describe("S163 task workspace cleanup", () => {
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
});
