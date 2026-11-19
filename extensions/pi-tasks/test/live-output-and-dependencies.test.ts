import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTaskRecord,
  listTaskMetadata,
  readTaskMetadata,
  taskLogPath,
  taskMetaPath,
  toTaskRecord,
  writeTaskMetadata,
} from "../src/registry.js";

describe("live task output and dependencies", () => {
  it("reads streamed log output and preserves declared dependencies", async () => {
    const dir = mkdtempSync(
      join(tmpdir(), "live-output-and-dependencies-tasks-"),
    );
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

  it("a task with no log and no metadata has empty output", async () => {
    const dir = mkdtempSync(
      join(tmpdir(), "live-output-and-dependencies-empty-"),
    );
    const record = createTaskRecord(dir, {
      id: "t2",
      kind: "shell",
      status: "running",
      cwd: "/repo",
      startedAt: 1,
    });
    expect(await record.output()).toBe("");
    expect(readTaskMetadata(dir, "missing")).toBeUndefined();
  });

  it("malformed metadata files are dropped from the registry", () => {
    const dir = mkdtempSync(
      join(tmpdir(), "live-output-and-dependencies-bad-"),
    );
    writeFileSync(taskMetaPath(dir, "broken"), JSON.stringify({ id: 7 }));
    writeTaskMetadata(dir, {
      id: "good",
      kind: "shell",
      status: "running",
      cwd: "/repo",
      startedAt: 1,
    });

    expect(readTaskMetadata(dir, "broken")).toBeUndefined();
    expect(listTaskMetadata(dir).map((task) => task.id)).toEqual(["good"]);
  });

  it("updated metadata is consumed as a live task record", async () => {
    const dir = mkdtempSync(
      join(tmpdir(), "live-output-and-dependencies-live-"),
    );
    createTaskRecord(dir, {
      id: "t3",
      kind: "shell",
      status: "running",
      cwd: "/repo",
      startedAt: 1,
    });
    writeFileSync(taskLogPath(dir, "t3"), "streamed\n");
    writeTaskMetadata(dir, {
      id: "t3",
      kind: "shell",
      status: "completed",
      cwd: "/repo",
      startedAt: 1,
      finishedAt: 2,
    });

    const listed = listTaskMetadata(dir);
    const updated = listed[0];
    expect(updated).toMatchObject({ id: "t3", status: "completed" });
    if (updated === undefined) throw new Error("missing task metadata");
    expect(await toTaskRecord(dir, updated).output()).toBe("streamed\n");
  });
});
