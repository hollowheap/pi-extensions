import { describe, expect, it, vi } from "vitest";
import {
  dropSessionSnapshot,
  extractSessionSummaryFromEntries,
  getSessionSnapshot,
  patchSessionSnapshot,
  subscribeSessionSnapshot,
  updateSessionSnapshot,
} from "./snapshot.js";
import {
  CWD_ENTRY,
  dropSession,
  readPersistedCwd,
  setCwd,
  setMode,
} from "./state.js";
import { restoreSessionUsage, setSessionBudgetCap } from "./usage.js";

describe("session snapshot", () => {
  it("stores, patches, subscribes, and drops snapshots per owner", () => {
    const owner = {};
    const events: unknown[] = [];
    const unsubscribe = subscribeSessionSnapshot(owner, (snap) => {
      events.push(snap);
    });

    updateSessionSnapshot(owner, "agent", {
      name: "coder",
      updatedAt: 100,
    });
    patchSessionSnapshot(owner, {
      todos: {
        total: 2,
        open: 1,
        done: 1,
        highPriority: 1,
        items: [
          { id: 1, text: "A", done: false, priority: "high" },
          { id: 2, text: "B", done: true },
        ],
        updatedAt: 200,
      },
    });

    expect(getSessionSnapshot(owner).agent?.name).toBe("coder");
    expect(getSessionSnapshot(owner).todos?.open).toBe(1);
    expect(events).toHaveLength(2);

    unsubscribe();
    updateSessionSnapshot(owner, "agent", undefined);
    expect(events).toHaveLength(2);
    expect(getSessionSnapshot(owner).agent).toBeUndefined();

    dropSessionSnapshot(owner);
    expect(getSessionSnapshot(owner)).toEqual({});
  });

  it("shares snapshot state across module reloads", async () => {
    const owner = {};
    updateSessionSnapshot(owner, "mode", { name: "plan", updatedAt: 123 });
    vi.resetModules();
    const fresh = await import("./snapshot.js");
    expect(fresh.getSessionSnapshot(owner).mode?.name).toBe("plan");
    fresh.dropSessionSnapshot(owner);
    expect(getSessionSnapshot(owner)).toEqual({});
  });

  it("syncs persisted cwd and usage budget cap into snapshot and branch entries", () => {
    const entries: { type?: string; customType: string; data?: unknown }[] = [];
    const owner = {
      appendCustomEntry: (customType: string, data?: unknown) => {
        entries.push({ type: "custom", customType, data });
        return "id";
      },
      getBranch: () => entries,
    };

    setMode(owner, "edit");
    setCwd(owner, "/repo/sub", { persist: true });
    setSessionBudgetCap(owner, 5.5, { persist: true });

    expect(readPersistedCwd(owner)).toBe("/repo/sub");
    expect(entries.some((e) => e.customType === CWD_ENTRY)).toBe(true);
    expect(getSessionSnapshot(owner).mode?.name).toBe("edit");
    expect(getSessionSnapshot(owner).cwd?.effective).toBe("/repo/sub");
    expect(getSessionSnapshot(owner).usage?.budgetCap).toBe(5.5);

    const restoredUsage = restoreSessionUsage(owner);
    expect(restoredUsage.budgetCap).toBe(5.5);

    setCwd(owner, undefined, { persist: true });
    expect(readPersistedCwd(owner)).toBeNull();
    dropSession(owner);
  });

  it("extracts rich session summary from branch entries", () => {
    const summary = extractSessionSummaryFromEntries([
      {
        type: "custom",
        customType: "hollowheap.core.mode",
        data: { mode: "autopilot" },
      },
      {
        type: "custom",
        customType: "hollowheap.core.cwd",
        data: { cwd: "/work/pkg" },
      },
      {
        type: "custom",
        customType: "hollowheap.agent",
        data: { name: "architect" },
      },
      {
        type: "custom",
        customType: "hollowheap.usage",
        data: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 25,
          cacheWriteTokens: 5,
          totalCost: 0.12,
          budgetCap: 2,
        },
      },
      {
        type: "custom",
        customType: "hollowheap.todos",
        data: {
          todos: [
            { id: 1, text: "First", done: false },
            { id: 2, text: "Second", done: true },
          ],
        },
      },
      {
        type: "custom",
        customType: "hollowheap.memory.observation",
        data: { id: "o1" },
      },
      {
        type: "custom",
        customType: "hollowheap.memory.observation",
        data: { id: "o2" },
      },
      {
        type: "custom",
        customType: "hollowheap.question.answers",
        data: { questions: [], answers: [] },
      },
      {
        type: "custom",
        customType: "hollowheap.web.history",
        data: { urls: ["https://example.com", "https://pi.dev"] },
      },
      {
        type: "custom",
        customType: "hollowheap.tasks.run",
        data: { id: "task-1" },
      },
      {
        type: "custom",
        customType: "hollowheap.subagents.run",
        data: { id: "sub-1" },
      },
    ]);

    expect(summary).toEqual({
      mode: "autopilot",
      cwd: "/work/pkg",
      agent: "architect",
      totalTokens: 180,
      totalCost: 0.12,
      budgetCap: 2,
      todosOpen: 1,
      todosTotal: 2,
      observations: 2,
      questionsAsked: 1,
      webLinks: 2,
      taskRuns: 1,
      subagentRuns: 1,
    });
  });

  it("extracts the latest decide call count from cumulative decide entries", () => {
    const summary = extractSessionSummaryFromEntries([
      {
        type: "custom",
        customType: "hollowheap.decide",
        data: { totalCount: 1, cacheHits: 0, updatedAt: 1 },
      },
      {
        type: "custom",
        customType: "hollowheap.decide",
        data: { totalCount: 4, cacheHits: 2, lastKind: "choice", updatedAt: 2 },
      },
    ]);

    expect(summary.decideCalls).toBe(4);
  });
});
