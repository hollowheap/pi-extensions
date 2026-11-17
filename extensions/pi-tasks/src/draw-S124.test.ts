import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTaskRecord,
  readTaskMetadata,
  taskLogPath,
} from "./registry.js";

describe("S124 live task output and dependencies", () => {
  it("reads streamed log output and preserves declared dependencies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s124-tasks-"));
    const record = createTaskRecord(dir, {
      id: "t1",
      kind: "shell",
      status: "completed",
      cwd: "/repo",
      startedAt: 1,
      dependsOn: ["t0"],
    });
    writeFileSync(taskLogPath(dir, "t1"), "line one\n");

    expect(await record.output()).toBe("line one\n");
    expect(readTaskMetadata(dir, "t1")?.dependsOn).toEqual(["t0"]);
  });
});
