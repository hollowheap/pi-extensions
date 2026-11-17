import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import guardExtension from "../../pi-guard/src/index.js";
import { createTaskTool } from "./task-tool.js";

const agentState = vi.hoisted(() => ({ agentDir: "/nonexistent-agent-dir" }));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAgentDir: () => agentState.agentDir,
}));

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "draw-s214-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  agentState.agentDir = "/nonexistent-agent-dir";
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("S214 task permission verdict consistency", () => {
  it("honours an active guard grant when starting a task", async () => {
    const agentDir = tempDir();
    agentState.agentDir = agentDir;
    writeFileSync(
      join(agentDir, "permissions.json"),
      JSON.stringify({ rules: [] }),
    );
    const workspace = tempDir();

    const guardPi = {
      on: vi.fn(() => () => {}),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      registerShortcut: vi.fn(),
      events: { on: vi.fn(() => () => {}), emit: vi.fn() },
    };
    guardExtension(guardPi as never);
    const grantDef = guardPi.registerCommand.mock.calls.find(
      ([name]) => name === "grant",
    )?.[1] as { handler: (args: string, ctx: unknown) => Promise<void> };

    const sessionManager = {};
    const ctx = {
      cwd: workspace,
      sessionManager,
      hasUI: true,
      isProjectTrusted: () => true,
      ui: { notify: vi.fn(), confirm: vi.fn(async () => true) },
    };
    await grantDef.handler("echo hi 5m", ctx);

    const confirm = vi.fn(async () => false);
    const tool = createTaskTool({
      getAgentDir: () => agentDir,
      onStatusChange: () => {},
      onTasksChange: () => {},
    });
    const taskCtx = {
      ...ctx,
      ui: { ...ctx.ui, setStatus: vi.fn(), confirm },
    };

    await tool.execute(
      "1",
      { action: "start", command: "echo hi" } as never,
      undefined,
      undefined,
      taskCtx as never,
    );

    expect(confirm).not.toHaveBeenCalled();
  });
});
