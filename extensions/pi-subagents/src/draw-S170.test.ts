import { describe, expect, it } from "vitest";
import {
  SUBAGENT_DEFINITION_TYPE,
  definitionsFromEntries,
} from "./definitions.js";

describe("S170 session agent definitions", () => {
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
});
