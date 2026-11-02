import { describe, expect, it } from "vitest";
import { mapUpstreamRuns } from "./upstream.js";

describe("upstream subagent mapper", () => {
  it("maps active runs to local state items and omits terminal runs", () => {
    const mapped = mapUpstreamRuns({
      runs: [
        {
          id: "up-1",
          label: "scout",
          state: "running",
          startedAt: 10,
          activity: { currentTool: "read", currentToolStartedAt: 12 },
        },
        {
          id: "up-2",
          state: "queued",
          startedAt: 20,
        },
        {
          id: "up-3",
          state: "completed",
          startedAt: 30,
        },
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
      {
        id: "up-2",
        agent: "upstream",
        task: "",
        state: "starting",
        startedAt: 20,
      },
    ]);
  });

  it("accepts a bare run array and drops unknown states", () => {
    expect(
      mapUpstreamRuns([
        { id: "up-1", state: "pending", startedAt: 1 },
        { id: "up-2", state: "mystery", startedAt: 2 },
      ]),
    ).toEqual([
      {
        id: "up-1",
        agent: "upstream",
        task: "",
        state: "starting",
        startedAt: 1,
      },
    ]);
  });

  it("never imports task text", () => {
    const mapped = mapUpstreamRuns([
      { id: "up-1", label: "secret task", state: "running", startedAt: 1 },
    ]);
    expect(mapped[0]?.task).toBe("");
    expect(mapped[0]?.agent).toBe("secret task");
  });
});
