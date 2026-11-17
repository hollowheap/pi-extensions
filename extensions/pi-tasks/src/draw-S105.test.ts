import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("S105 shared process package ownership", () => {
  it("makes both extensions consume runtime without duplicating subagent machinery in pi-tasks", () => {
    const root = process.cwd();
    const tasks = JSON.parse(
      readFileSync(resolve(root, "extensions/pi-tasks/package.json"), "utf8"),
    );
    const subagents = JSON.parse(
      readFileSync(
        resolve(root, "extensions/pi-subagents/package.json"),
        "utf8",
      ),
    );
    expect(tasks.dependencies["@hollowheap/runtime"]).toBeDefined();
    expect(subagents.dependencies["@hollowheap/runtime"]).toBeDefined();
    expect(subagents.dependencies["@hollowheap/policy"]).toBeDefined();
    expect(tasks.dependencies["@hollowheap/policy"]).toBeUndefined();
    expect(
      existsSync(resolve(root, "extensions/pi-tasks/src/write-lock.ts")),
    ).toBe(false);
  });
});
