import { describe, expect, it } from "vitest";
import { mapUpstreamRuns } from "./upstream.js";

describe("S167 upstream run mapping", () => {
  it("maps an active run into a local state item and omits terminal runs", () => {
    const mapped = mapUpstreamRuns({
      runs: [
        {
          id: "up-1",
          label: "scout",
          state: "running",
          startedAt: 10,
          activity: { currentTool: "read", currentToolStartedAt: 12 },
        },
        { id: "up-2", state: "completed", startedAt: 30 },
      ],
    });

    expect(mapped).toEqual([
      {
        id: "up-1",
        agent: "scout",
        task: "",
        state: "running",
        startedAt: 10,
        activeTool: "read",
        activeToolStartedAt: 12,
      },
    ]);
  });
});
