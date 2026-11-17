import { describe, expect, it } from "vitest";
import {
  SUBAGENT_DEFINITION_DELETE_TYPE,
  SUBAGENT_DEFINITION_TYPE,
  definitionsFromEntries,
} from "./definitions.js";

describe("S171 session definition tombstones", () => {
  it("removes a definition at its tombstone and allows a later redefinition", () => {
    const definition = {
      name: "scout",
      description: "Scout",
      systemPrompt: "One",
    };
    const entries = [
      {
        type: "custom",
        customType: SUBAGENT_DEFINITION_TYPE,
        data: definition,
      },
      {
        type: "custom",
        customType: SUBAGENT_DEFINITION_DELETE_TYPE,
        data: { name: "scout" },
      },
      {
        type: "custom",
        customType: SUBAGENT_DEFINITION_TYPE,
        data: { ...definition, systemPrompt: "Two" },
      },
    ];

    const agents = definitionsFromEntries(entries);

    expect(agents.get("scout")?.systemPrompt).toBe("Two");
  });
});
