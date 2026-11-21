import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { reconcileSubagent } from "../src/runner.js";
import { SubagentStore } from "../src/state.js";

it("drops running states that predate the current boot", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-subagents-boot-"));
  try {
    const store = new SubagentStore(root);
    const state = {
      id: "old",
      status: "running" as const,
      agent: "scout",
      task: "a",
      depth: 1,
      attempt: 1,
      startedAt: 1,
    };
    store.write(state);

    const result = await reconcileSubagent(root, state);

    expect(result.status).toBe("failed");
    expect(store.read("old")).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
