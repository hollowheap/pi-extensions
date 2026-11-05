import { describe, expect, it } from "vitest";
import {
  SUBAGENT_DEFINITION_TYPE,
  definitionsFromEntries,
} from "./definitions.js";

function entry(data: unknown) {
  return { type: "custom", customType: SUBAGENT_DEFINITION_TYPE, data };
}

describe("definitionsFromEntries", () => {
  it("parses session agent definitions", () => {
    const agents = definitionsFromEntries([
      entry({
        name: " reviewer ",
        description: " Reviews changes ",
        systemPrompt: " You review code. ",
        tools: [" read ", "", "grep"],
        model: " p/m ",
        thinking: " high ",
        mode: " plan ",
        effort: " low ",
        harness: " claude ",
      }),
    ]);

    expect(agents.get("reviewer")).toEqual({
      name: "reviewer",
      description: "Reviews changes",
      systemPrompt: "You review code.",
      tools: ["read", "grep"],
      model: "p/m",
      thinking: "high",
      mode: "plan",
      effort: "low",
      harness: "claude",
      source: "session",
    });
  });

  it("ignores malformed entries and unrelated custom entries", () => {
    const agents = definitionsFromEntries([
      null,
      "entry",
      { customType: "other", data: { name: "other" } },
      entry({ name: "", description: "D", systemPrompt: "P" }),
      entry({ name: "missing-description", systemPrompt: "P" }),
      entry({ name: "missing-prompt", description: "D" }),
      entry({
        name: "valid",
        description: "D",
        systemPrompt: "P",
        tools: "read",
      }),
    ]);

    expect([...agents.keys()]).toEqual(["valid"]);
    expect(agents.get("valid")?.tools).toBeUndefined();
  });

  it("ignores non-array input", () => {
    expect(definitionsFromEntries(undefined).size).toBe(0);
    expect(definitionsFromEntries({}).size).toBe(0);
  });

  it("lets the latest definition of a name win", () => {
    const agents = definitionsFromEntries([
      entry({ name: "scout", description: "First", systemPrompt: "One" }),
      entry({ name: "scout", description: "Second", systemPrompt: "Two" }),
    ]);

    expect(agents.get("scout")).toMatchObject({
      description: "Second",
      systemPrompt: "Two",
    });
  });
});
