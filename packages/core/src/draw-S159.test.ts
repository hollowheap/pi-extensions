import { describe, expect, it, vi } from "vitest";
import { allocateWorkspace, cleanupWorkspace } from "./workspace.js";

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
});
