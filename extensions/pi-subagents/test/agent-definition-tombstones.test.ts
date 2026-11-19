import { describe, expect, it } from "vitest";
import {
  SUBAGENT_DEFINITION_DELETE_TYPE,
  SUBAGENT_DEFINITION_TYPE,
  definitionsFromEntries,
} from "../src/definitions.js";

describe("session definition tombstones", () => {
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

  it("a tombstone without a prior definition leaves the map empty", () => {
    const agents = definitionsFromEntries([
      {
        type: "custom",
        customType: SUBAGENT_DEFINITION_DELETE_TYPE,
        data: { name: "never-defined" },
      },
    ]);

    expect(agents.size).toBe(0);
    expect(agents.has("never-defined")).toBe(false);
  });

  it("malformed tombstones and entries do not disturb valid definitions", () => {
    const agents = definitionsFromEntries([
      {
        type: "custom",
        customType: SUBAGENT_DEFINITION_TYPE,
        data: { name: "keep", description: "Keep", systemPrompt: "Yes" },
      },
      { type: "custom", customType: SUBAGENT_DEFINITION_DELETE_TYPE, data: {} },
      { type: "custom", customType: SUBAGENT_DEFINITION_DELETE_TYPE },
      { type: "custom", customType: "other", data: { name: "keep" } },
    ]);

    expect([...agents.keys()]).toEqual(["keep"]);
  });

  it("a trailing tombstone removes an earlier definition outright", () => {
    const agents = definitionsFromEntries([
      {
        type: "custom",
        customType: SUBAGENT_DEFINITION_TYPE,
        data: { name: "gone", description: "Gone", systemPrompt: "Yes" },
      },
      {
        type: "custom",
        customType: SUBAGENT_DEFINITION_DELETE_TYPE,
        data: { name: " gone " },
      },
    ]);

    expect(agents.size).toBe(0);
    expect(agents.has("gone")).toBe(false);
  });
});
