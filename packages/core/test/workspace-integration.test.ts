import { describe, expect, it, vi } from "vitest";
import {
  allocateWorkspace,
  cleanupWorkspace,
  integrateWorkspace,
} from "../src/workspace.js";

describe("explicit workspace integration and cleanup", () => {
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

  it("integration awaits an asynchronous callback before returning", async () => {
    let finished = false;
    const makeDirectory = vi.fn(async () => {});
    const workspace = await allocateWorkspace(
      "/repo",
      "task-2",
      { enabled: true },
      { makeDirectory },
    );

    await integrateWorkspace(workspace, async () => {
      await Promise.resolve();
      finished = true;
    });

    expect(finished).toBe(true);
  });

  it("an integration callback rejection reaches the caller", async () => {
    const workspace = { path: "/repo/.pi-workspaces/task-3", isolated: true };

    await expect(
      integrateWorkspace(workspace, async () => {
        throw new Error("integration failed");
      }),
    ).rejects.toThrow("integration failed");
  });

  it("cleanup ignores a shared workspace even with a remover supplied", async () => {
    const removeDirectory = vi.fn(async () => {});

    await cleanupWorkspace(
      { path: "/repo", isolated: false },
      { removeDirectory },
    );

    expect(removeDirectory).not.toHaveBeenCalled();
  });
});
