import { describe, expect, it } from "vitest";
import {
  MEMORY_CLEAR_TYPE,
  MEMORY_CONSUMED_TYPE,
  MEMORY_OBSERVATION_TYPE,
  MEMORY_REFLECTION_TYPE,
  memoryFromEntries,
  pendingMessageEntries,
  renderMemory,
} from "./ledger.js";

function custom(customType: string, data: unknown) {
  return { type: "custom", customType, data };
}

function message(id: string, role = "user") {
  return {
    type: "message",
    id,
    message: {
      role,
      content: [{ type: "text", text: `message ${id}` }],
    },
  };
}

describe("memoryFromEntries", () => {
  it("parses observations, reflections, consumed markers, and clears in order", () => {
    const ledger = memoryFromEntries([
      custom(MEMORY_OBSERVATION_TYPE, {
        id: "obs1",
        text: "Prefer small commits",
        relevance: 5,
        createdAt: 10,
        sourceEntryIds: ["m1"],
      }),
      custom(MEMORY_REFLECTION_TYPE, {
        id: "ref1",
        text: "User values review",
        createdAt: 11,
        sourceObservationIds: ["obs1"],
      }),
      custom(MEMORY_CONSUMED_TYPE, { sourceEntryIds: ["m2"] }),
      custom(MEMORY_CLEAR_TYPE, { sourceEntryIds: ["m3"] }),
      custom(MEMORY_OBSERVATION_TYPE, {
        id: "obs2",
        text: "Uses pnpm",
        createdAt: 12,
        sourceEntryIds: ["m4"],
      }),
    ]);

    expect(ledger.observations).toEqual([
      expect.objectContaining({ id: "obs2", relevance: 3 }),
    ]);
    expect(ledger.reflections).toEqual([]);
    expect([...ledger.consumedIds]).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("ignores malformed and duplicate entries", () => {
    const ledger = memoryFromEntries([
      null,
      "entry",
      { type: "message", id: "m1" },
      custom(MEMORY_OBSERVATION_TYPE, { id: "", text: "ignored" }),
      custom(MEMORY_OBSERVATION_TYPE, { id: "obs", text: " " }),
      custom(MEMORY_OBSERVATION_TYPE, {
        id: "obs",
        text: "Kept",
        relevance: 9,
        sourceEntryIds: ["m1", 2],
      }),
      custom(MEMORY_OBSERVATION_TYPE, {
        id: "obs",
        text: "Duplicate",
      }),
    ]);

    expect(ledger.observations).toEqual([
      expect.objectContaining({ id: "obs", text: "Kept", relevance: 5 }),
    ]);
  });

  it("returns an empty ledger for non-array input", () => {
    expect(memoryFromEntries(undefined).observations).toEqual([]);
    expect(memoryFromEntries({}).consumedIds.size).toBe(0);
  });
});

describe("pendingMessageEntries", () => {
  it("keeps only unconsumed message entries", () => {
    const entries = [message("m1"), custom("other", {}), message("m2")];
    expect(pendingMessageEntries(entries, new Set(["m1"]))).toEqual([
      expect.objectContaining({ id: "m2" }),
    ]);
  });
});

describe("renderMemory", () => {
  it("renders observations in relevance order within the token budget", () => {
    const ledger = memoryFromEntries([
      custom(MEMORY_OBSERVATION_TYPE, {
        id: "low",
        text: "Low priority",
        relevance: 1,
        createdAt: 1,
      }),
      custom(MEMORY_OBSERVATION_TYPE, {
        id: "high",
        text: "High priority",
        relevance: 5,
        createdAt: 2,
      }),
    ]);

    const text = renderMemory(ledger, { maxTokens: 100 });
    expect(text).toContain("## Durable memory");
    expect(text.indexOf("High priority")).toBeLessThan(
      text.indexOf("Low priority"),
    );
  });

  it("returns an empty string without memory and respects a small budget", () => {
    expect(renderMemory(memoryFromEntries([]), { maxTokens: 100 })).toBe("");

    const ledger = memoryFromEntries([
      custom(MEMORY_OBSERVATION_TYPE, {
        id: "obs",
        text: "x".repeat(200),
        relevance: 5,
        createdAt: 1,
      }),
    ]);
    expect(renderMemory(ledger, { maxTokens: 5 })).toBe("");
  });
});
