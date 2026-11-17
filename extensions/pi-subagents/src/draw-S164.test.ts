import { describe, expect, it, vi } from "vitest";
import { SubagentWorkspaceTracker } from "./workspace.js";

describe("S164 subagent workspace cleanup", () => {
  it("cleans a tracked workspace when its subagent reaches a terminal status", async () => {
    const cleanup = vi.fn(async () => {});
    const cleaned: string[] = [];
    const tracker = new SubagentWorkspaceTracker(cleanup);
    const workspace = { path: "/repo/.pi-workspaces/sub-1", isolated: true };
    tracker.track("sub-1", workspace);

    await tracker.cleanupTerminal(
      [
        { id: "sub-1", status: "running" },
        { id: "sub-1", status: "failed" },
      ],
      (id) => cleaned.push(id),
    );

    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith(workspace);
    expect(cleaned).toEqual(["sub-1"]);
  });
});
