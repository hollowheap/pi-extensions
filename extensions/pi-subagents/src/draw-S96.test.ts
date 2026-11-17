import { describe, expect, it } from "vitest";
import { createSubagentTool } from "./tool.js";

describe("S96 direct subagent actions", () => {
  it("exposes start/list/status/send/wait/cancel/resume as the tool actions", () => {
    const tool = createSubagentTool();
    expect(tool.name).toBe("subagent");
    const schema = JSON.stringify(tool.parameters);
    for (const action of [
      "start",
      "list",
      "status",
      "send",
      "wait",
      "cancel",
      "resume",
    ]) {
      expect(schema).toContain(`"${action}"`);
    }
  });
});
