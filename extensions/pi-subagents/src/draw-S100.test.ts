import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProcessStore } from "@hollowheap/runtime/state";
import {
  isInProject,
  requireTrustedProject,
  subagentDisplayName,
} from "./state.js";

describe("S100 subagent state safety", () => {
  it("requires trust, scopes visibility to a project, and writes permissioned state", () => {
    expect(() => requireTrustedProject(false)).toThrow(/trusted/);
    expect(isInProject({ project: "/a" }, "/a")).toBe(true);
    expect(isInProject({ project: "/a" }, "/b")).toBe(false);

    const dir = mkdtempSync(join(tmpdir(), "s100-state-"));
    const store = new ProcessStore(join(dir, "subagents"));
    store.write({
      id: "s1",
      status: "running",
      startedAt: 1,
      agent: "scout",
      task: "find",
    });
    expect(statSync(store.dir).mode & 0o777).toBe(0o700);
    expect(statSync(store.statePath("s1")).mode & 0o777).toBe(0o600);
    expect(
      subagentDisplayName({ agent: "scout", task: "find things" }),
    ).toContain("find things");
  });
});
