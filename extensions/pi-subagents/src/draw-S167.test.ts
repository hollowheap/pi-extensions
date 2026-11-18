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

  it("S167 C02: an absent or empty snapshot maps to no items", () => {
    expect(mapUpstreamRuns(undefined)).toEqual([]);
    expect(mapUpstreamRuns([])).toEqual([]);
    expect(mapUpstreamRuns({ runs: [] })).toEqual([]);
  });

  it("S167 C03: queued and pending runs map to starting while unknown states drop", () => {
    const mapped = mapUpstreamRuns([
      { id: "q", state: "queued", startedAt: 1 },
      { id: "p", state: "pending", startedAt: 2 },
      { id: "s", state: "starting", startedAt: 3 },
      { id: "x", state: "zombie", startedAt: 4 },
    ]);

    expect(mapped).toEqual([
      { id: "q", agent: "upstream", task: "", state: "starting", startedAt: 1 },
      { id: "p", agent: "upstream", task: "", state: "starting", startedAt: 2 },
      { id: "s", agent: "upstream", task: "", state: "starting", startedAt: 3 },
    ]);
  });

  it("S167 C04: an explicit agent wins over a label and omitted activity adds no keys", () => {
    const mapped = mapUpstreamRuns([
      {
        id: "up-3",
        agent: "scout",
        label: "ignored",
        state: "running",
        startedAt: 20,
      },
    ]);

    expect(mapped).toEqual([
      { id: "up-3", agent: "scout", task: "", state: "running", startedAt: 20 },
    ]);
    expect(mapped[0]).not.toHaveProperty("activeTool");
    expect(mapped[0]).not.toHaveProperty("activeToolStartedAt");
  });
});
