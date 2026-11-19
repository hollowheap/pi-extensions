import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("shared process package ownership", () => {
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

  it("both manifests pin the same runtime version", () => {
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
    expect(tasks.dependencies["@hollowheap/runtime"]).toBe("^0.3.0");
    expect(subagents.dependencies["@hollowheap/runtime"]).toBe("^0.3.0");
  });

  it("the manifests parse with their expected package names", () => {
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
    expect(tasks.name).toBe("@hollowheap/pi-tasks");
    expect(subagents.name).toBe("@hollowheap/pi-subagents");
  });

  it("both extensions import the shared spawn lifecycle subpath", () => {
    const root = process.cwd();
    const tasksRunner = readFileSync(
      resolve(root, "extensions/pi-tasks/src/runner.ts"),
      "utf8",
    );
    const subagentsRunner = readFileSync(
      resolve(root, "extensions/pi-subagents/src/runner.ts"),
      "utf8",
    );
    expect(tasksRunner).toContain('from "@hollowheap/runtime/lifecycle"');
    expect(subagentsRunner).toContain('from "@hollowheap/runtime/lifecycle"');
  });
});
