import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTaskTool } from "./task-tool.js";

function createCtx(cwd: string, trusted: boolean) {
  return {
    cwd,
    sessionManager: {},
    hasUI: true,
    isProjectTrusted: () => trusted,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      confirm: vi.fn(async () => true),
    },
  };
}

function getText(result: { content: Array<{ text?: string }> }): string {
  return result.content.map((c) => c.text ?? "").join("\n");
}

describe("S72: the direct task tool requires trust and non-empty commands", () => {
  it("exposes direct actions and refuses start in an untrusted project", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-tasks-draw-tool-"));
    const tool = createTaskTool({
      getAgentDir: () => agentDir,
      onStatusChange: () => {},
      onTasksChange: () => {},
    });
    expect(tool.name).toBe("task");
    expect("exposure" in tool).toBe(false);

    const result = await tool.execute(
      "1",
      { action: "start", command: "echo hello" } as never,
      undefined,
      undefined,
      createCtx(agentDir, false) as never,
    );
    expect(getText(result as never)).toContain("trusted project");
    rmSync(agentDir, { recursive: true, force: true });
  });
});
