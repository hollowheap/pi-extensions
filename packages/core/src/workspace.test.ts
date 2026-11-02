import { describe, expect, it, vi } from "vitest";
import {
  allocateWorkspace,
  cleanupWorkspace,
  integrateWorkspace,
  workspacePath,
} from "./workspace.js";

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
