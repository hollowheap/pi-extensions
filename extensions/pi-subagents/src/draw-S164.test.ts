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

  it("S164 C02: a running subagent leaves its workspace and callback untouched", async () => {
    const cleanup = vi.fn(async () => {});
    const onCleaned = vi.fn();
    const tracker = new SubagentWorkspaceTracker(cleanup);
    tracker.track("sub-2", {
      path: "/repo/.pi-workspaces/sub-2",
      isolated: true,
    });

    await tracker.cleanupTerminal(
      [{ id: "sub-2", status: "running" }],
      onCleaned,
    );

    expect(cleanup).not.toHaveBeenCalled();
    expect(onCleaned).not.toHaveBeenCalled();
  });

  it("S164 C03: a failed cleanup does not report the id to the callback", async () => {
    const cleanup = vi.fn(async () => {
      throw new Error("rm failed");
    });
    const onCleaned = vi.fn();
    const tracker = new SubagentWorkspaceTracker(cleanup);
    tracker.track("sub-3", {
      path: "/repo/.pi-workspaces/sub-3",
      isolated: true,
    });

    await expect(
      tracker.cleanupTerminal(
        [{ id: "sub-3", status: "cancelled" }],
        onCleaned,
      ),
    ).resolves.toBeUndefined();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(onCleaned).not.toHaveBeenCalled();
  });

  it("S164 C04: repeated terminal observations clean and report only once", async () => {
    const cleanup = vi.fn(async () => {});
    const cleaned: string[] = [];
    const tracker = new SubagentWorkspaceTracker(cleanup);
    tracker.track("sub-4", {
      path: "/repo/.pi-workspaces/sub-4",
      isolated: true,
    });

    await tracker.cleanupTerminal(
      [{ id: "sub-4", status: "completed" }],
      (id) => cleaned.push(id),
    );
    await tracker.cleanupTerminal(
      [{ id: "sub-4", status: "completed" }],
      (id) => cleaned.push(id),
    );

    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleaned).toEqual(["sub-4"]);
  });
});
