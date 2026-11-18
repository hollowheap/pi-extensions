import { describe, expect, it, vi } from "vitest";
import {
  allocateWorkspace,
  cleanupWorkspace,
  integrateWorkspace,
  workspacePath,
} from "./workspace.js";

describe("S159 workspace isolation is opt-in", () => {
  it("keeps the shared root and creates no directory when isolation is omitted", async () => {
    const makeDirectory = vi.fn(async () => {});
    const workspace = await allocateWorkspace(
      "/repo",
      "task-1",
      {},
      {
        makeDirectory,
      },
    );

    expect(workspace).toEqual({ path: "/repo", isolated: false });
    expect(makeDirectory).not.toHaveBeenCalled();

    const removeDirectory = vi.fn(async () => {});
    await cleanupWorkspace(workspace, { removeDirectory });
    expect(removeDirectory).not.toHaveBeenCalled();
  });

  it("S159 C02: workspace ids containing path traversal are rejected", () => {
    expect(() => workspacePath("/repo", "../outside")).toThrow(
      /invalid workspace id/,
    );
    expect(() => workspacePath("/repo", "..")).toThrow(/invalid workspace id/);
    expect(() => workspacePath("/repo", ".")).toThrow(/invalid workspace id/);
  });

  it("S159 C03: an enabled allocation creates a dedicated nested directory", async () => {
    const makeDirectory = vi.fn(async () => {});
    const workspace = await allocateWorkspace(
      "/repo",
      "task-2",
      { enabled: true },
      { makeDirectory },
    );

    expect(workspace).toEqual({
      path: "/repo/.pi-workspaces/task-2",
      isolated: true,
    });
    expect(makeDirectory).toHaveBeenCalledWith(workspace.path);
  });

  it("S159 C04: integration refuses a workspace that is not isolated", async () => {
    const integrate = vi.fn();
    const workspace = { path: "/repo", isolated: false };

    await expect(integrateWorkspace(workspace, integrate)).rejects.toThrow(
      /not isolated/,
    );
    expect(integrate).not.toHaveBeenCalled();
  });
});
