import * as runtime from "@hollowheap/runtime";
import { describe, expect, it } from "vitest";

describe("S103 runtime package exports", () => {
  it("exports detached lifecycle, state, and socket primitives", () => {
    expect(typeof runtime.spawnDetachedProcess).toBe("function");
    expect(typeof runtime.spawnDetachedTask).toBe("function");
    expect(typeof runtime.ProcessStore).toBe("function");
    expect(typeof runtime.LockedProcessStore).toBe("function");
    expect(typeof runtime.startJsonlServer).toBe("function");
    expect(typeof runtime.requestJsonl).toBe("function");
    expect(typeof runtime.buildSandboxArgs).toBe("function");
  });
});
