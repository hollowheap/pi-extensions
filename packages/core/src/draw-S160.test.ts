import { describe, expect, it, vi } from "vitest";
import {
  allocateWorkspace,
  cleanupWorkspace,
  integrateWorkspace,
} from "./workspace.js";

describe("S160 explicit workspace integration and cleanup", () => {
  it("integrates only through an explicit callback and cleans only isolated workspaces", async () => {
    const makeDirectory = vi.fn(async () => {});
    const removeDirectory = vi.fn(async () => {});
    const workspace = await allocateWorkspace(
      "/repo",
      "task-1",
      { enabled: true },
      {
        makeDirectory,
      },
    );
    const integrate = vi.fn();

    await integrateWorkspace(workspace, integrate);
    await cleanupWorkspace(workspace, { removeDirectory });

    expect(integrate).toHaveBeenCalledWith(workspace.path);
    expect(removeDirectory).toHaveBeenCalledOnce();
    expect(removeDirectory).toHaveBeenCalledWith(workspace.path);
  });
});
