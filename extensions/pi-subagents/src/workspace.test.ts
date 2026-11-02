import { describe, expect, it, vi } from "vitest";
import {
  SubagentWorkspaceTracker,
  allocateSubagentWorkspace,
  cleanupSubagentWorkspace,
  integrateSubagentWorkspace,
} from "./workspace.js";

describe("subagent workspace", () => {
  it("keeps the shared root unless explicitly enabled", async () => {
    const makeDirectory = vi.fn(async () => {});
    const workspace = await allocateSubagentWorkspace(
      { root: "C:\\repo", id: "subagent-1" },
      { makeDirectory },
    );

    expect(workspace).toEqual({ path: "C:\\repo", isolated: false });
    expect(makeDirectory).not.toHaveBeenCalled();
  });

  it("allocates and cleans up an isolated subagent workspace", async () => {
    const makeDirectory = vi.fn(async () => {});
    const removeDirectory = vi.fn(async () => {});
    const workspace = await allocateSubagentWorkspace(
      { root: "C:\\repo", id: "subagent-1", enabled: true },
      { makeDirectory },
    );

    await cleanupSubagentWorkspace(workspace, { removeDirectory });

    expect(workspace.isolated).toBe(true);
    expect(makeDirectory).toHaveBeenCalledWith(workspace.path);
    expect(removeDirectory).toHaveBeenCalledWith(workspace.path);
  });

  it("requires explicit integration for isolated subagents", async () => {
    const integrate = vi.fn();
    const workspace = { path: "C:\\repo\\isolated", isolated: true };

    await integrateSubagentWorkspace(workspace, integrate);
    expect(integrate).toHaveBeenCalledWith("C:\\repo\\isolated");
    await expect(
      integrateSubagentWorkspace(
        { path: "C:\\repo", isolated: false },
        integrate,
      ),
    ).rejects.toThrow(/not isolated/);
  });
});

describe("subagent workspace tracker", () => {
  it("cleans only terminal isolated workspaces", async () => {
    const cleanup = vi.fn(async () => {});
    const tracker = new SubagentWorkspaceTracker(cleanup);
    tracker.track("subagent-1", {
      path: "/repo/isolated",
      isolated: true,
    });
    tracker.track("subagent-2", { path: "/repo/shared", isolated: false });

    await tracker.cleanupTerminal([
      { id: "subagent-1", status: "running" },
      { id: "subagent-2", status: "completed" },
    ]);
    expect(cleanup).not.toHaveBeenCalled();

    await tracker.cleanupTerminal([{ id: "subagent-1", status: "failed" }]);
    expect(cleanup).toHaveBeenCalledWith({
      path: "/repo/isolated",
      isolated: true,
    });
  });
});
