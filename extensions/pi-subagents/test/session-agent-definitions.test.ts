import { describe, expect, it } from "vitest";
import {
  SUBAGENT_DEFINITION_TYPE,
  definitionsFromEntries,
} from "../src/definitions.js";

describe("session agent definitions", () => {
  it("parses and trims a session-defined agent from branch entries", () => {
    const agents = definitionsFromEntries([
      {
        type: "custom",
        customType: SUBAGENT_DEFINITION_TYPE,
        data: {
          name: " reviewer ",
          description: " Reviews changes ",
          systemPrompt: " You review code. ",
          tools: [" read ", "", "grep"],
          harness: " claude ",
        },
      },
    ]);

    expect(agents.get("reviewer")).toEqual({
      name: "reviewer",
      description: "Reviews changes",
      systemPrompt: "You review code.",
      tools: ["read", "grep"],
      harness: "claude",
      source: "session",
    });
  });

  it("empty or non-array entries produce an empty definition map", () => {
    expect(definitionsFromEntries([]).size).toBe(0);
    expect(definitionsFromEntries(undefined).size).toBe(0);
    expect(definitionsFromEntries({ data: {} }).size).toBe(0);
  });

  it("malformed and non-custom entries are skipped", () => {
    const agents = definitionsFromEntries([
      { type: "message" },
      {
        type: "custom",
        customType: "unrelated.custom",
        data: { name: "noise", description: "d", systemPrompt: "p" },
      },
      {
        type: "custom",
        customType: SUBAGENT_DEFINITION_TYPE,
        data: { name: "no-description", systemPrompt: "p" },
      },
      {
        type: "custom",
        customType: SUBAGENT_DEFINITION_TYPE,
        data: { name: "   ", description: "d", systemPrompt: "p" },
      },
    ]);

    expect([...agents.keys()]).toEqual([]);
  });

  it("a model qualifier is split into model and thinking fields", () => {
    const agents = definitionsFromEntries([
      {
        type: "custom",
        customType: SUBAGENT_DEFINITION_TYPE,
        data: {
          name: "deep",
          description: "Deep review",
          systemPrompt: "Think hard",
          model: " claude/sonnet:high ",
        },
      },
    ]);

    expect(agents.get("deep")).toMatchObject({
      name: "deep",
      model: "claude/sonnet",
      thinking: "high",
      source: "session",
    });
  });
});
