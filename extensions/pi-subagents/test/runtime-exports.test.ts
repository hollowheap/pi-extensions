import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as runtime from "@hollowheap/runtime";
import { describe, expect, it } from "vitest";

describe("runtime package exports", () => {
  it("exports detached lifecycle, state, and socket primitives", () => {
    expect(typeof runtime.spawnDetachedProcess).toBe("function");
    expect(typeof runtime.spawnDetachedTask).toBe("function");
    expect(typeof runtime.ProcessStore).toBe("function");
    expect(typeof runtime.LockedProcessStore).toBe("function");
    expect(typeof runtime.startJsonlServer).toBe("function");
    expect(typeof runtime.requestJsonl).toBe("function");
    expect(typeof runtime.buildSandboxArgs).toBe("function");
  });

  it("the runtime package declares no host dependencies", () => {
    const pkg = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "packages/runtime/package.json"),
        "utf8",
      ),
    );
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.exports["./*"]).toBe("./src/*.ts");
  });

  it("subpath entry points expose the expected primitives", async () => {
    const sandbox = await import("@hollowheap/runtime/sandbox");
    const store = await import("@hollowheap/runtime/store");
    const process = await import("@hollowheap/runtime/process");
    expect(typeof sandbox.buildSandboxArgs).toBe("function");
    expect(typeof store.LockedProcessStore).toBe("function");
    expect(typeof process.isProcessAlive).toBe("function");
  });

  it("a consumer writes and reads state through the exported store", () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-exports-runtime-"));
    const store = new runtime.ProcessStore(join(dir, "state"));
    store.write({ id: "p1", status: "running", startedAt: 1 });
    expect(store.read("p1")).toMatchObject({ id: "p1", status: "running" });
  });
});
