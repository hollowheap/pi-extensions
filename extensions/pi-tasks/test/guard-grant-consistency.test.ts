import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import guardExtension from "../../pi-guard/src/index.js";
import { createTaskTool } from "../src/task-tool.js";

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

describe("task permission verdict consistency", () => {
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

  it("an empty command is rejected before approval or spawn", async () => {
    const tool = createTaskTool({
      getAgentDir: () => tempDir(),
      onStatusChange: () => {},
      onTasksChange: () => {},
    });
    const confirm = vi.fn(async () => true);
    const ctx = {
      cwd: tempDir(),
      sessionManager: {},
      hasUI: true,
      isProjectTrusted: () => true,
      ui: { notify: vi.fn(), confirm },
    };

    const result = await tool.execute(
      "2",
      { action: "start", command: "   " } as never,
      undefined,
      undefined,
      ctx as never,
    );

    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      "task start requires a command.",
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it("an untrusted project blocks the start before permission checks", async () => {
    const tool = createTaskTool({
      getAgentDir: () => tempDir(),
      onStatusChange: () => {},
      onTasksChange: () => {},
    });
    const confirm = vi.fn(async () => true);
    const ctx = {
      cwd: tempDir(),
      sessionManager: {},
      hasUI: true,
      isProjectTrusted: () => false,
      ui: { notify: vi.fn(), confirm },
    };

    const result = await tool.execute(
      "3",
      { action: "start", command: "echo hi" } as never,
      undefined,
      undefined,
      ctx as never,
    );

    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      "task start requires a trusted project",
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it("headless ask blocks instead of becoming an allow", async () => {
    const agentDir = tempDir();
    writeFileSync(
      join(agentDir, "permissions.json"),
      JSON.stringify({ rules: [] }),
    );
    const tool = createTaskTool({
      getAgentDir: () => agentDir,
      onStatusChange: () => {},
      onTasksChange: () => {},
    });
    const confirm = vi.fn(async () => true);
    const ctx = {
      cwd: tempDir(),
      sessionManager: {},
      hasUI: false,
      isProjectTrusted: () => true,
      ui: { notify: vi.fn(), confirm },
    };

    const result = await tool.execute(
      "4",
      { action: "start", command: "echo hi" } as never,
      undefined,
      undefined,
      ctx as never,
    );

    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      "needs approval (no UI)",
    );
    expect(confirm).not.toHaveBeenCalled();
  });
});
