import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnShellTask, waitForTask } from "./runner.js";

describe("S70: durable tasks spawn detached and publish stdout/stderr to the log", () => {
  let agentDir: string;
  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-tasks-draw-runner-"));
  });
  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("streams both streams and atomically records completion", async () => {
    const task = await spawnShellTask({
      agentDir,
      command: "echo out-line; echo err-line >&2",
      cwd: process.cwd(),
    });
    expect(task.id).toMatch(/^task-/);
    expect(task.kind).toBe("shell");
    expect(task.pid).toBeTypeOf("number");

    const finished = await waitForTask(agentDir, task.id, 5000);
    expect(finished?.status).toBe("completed");
    expect(finished?.exitCode).toBe(0);
    expect(finished?.finishedAt).toBeTypeOf("number");
    const output = await finished?.output();
    expect(output).toContain("out-line");
    expect(output).toContain("err-line");
  });
});
