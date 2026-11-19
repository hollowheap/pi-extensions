import { describe, expect, it, vi } from "vitest";
import { createSubagentTool } from "../src/tool.js";

describe("direct subagent actions", () => {
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

  it("exposes direct mode and the define/delete lifecycle actions", () => {
    const tool = createSubagentTool();
    expect(tool.exposure).toBe("direct");
    expect(tool.label).toBe("subagent");
    const schema = JSON.stringify(tool.parameters);
    expect(schema).toContain('"define"');
    expect(schema).toContain('"delete"');
  });

  it("rejects an unknown action with an error result", async () => {
    const tool = createSubagentTool();
    const result = await tool.execute(
      "1",
      { action: "bogus", id: "sub-1" } as never,
      undefined,
      undefined,
      {} as never,
    );
    expect(JSON.stringify(result)).toContain("invalid action: bogus");
  });

  it("the delete action delegates to the session-agent hook", async () => {
    const deleteSessionAgent = vi.fn(() => true);
    const tool = createSubagentTool({ deleteSessionAgent });
    const result = await tool.execute(
      "1",
      { action: "delete", name: "reviewer" } as never,
      undefined,
      undefined,
      {} as never,
    );
    expect(deleteSessionAgent).toHaveBeenCalledWith("reviewer");
    expect(JSON.stringify(result)).toContain("deleted");
  });
});
