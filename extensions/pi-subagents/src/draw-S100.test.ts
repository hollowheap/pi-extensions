import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessStore } from "@hollowheap/runtime/state";
import { describe, expect, it } from "vitest";
import {
  SubagentStore,
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
    expect(subagentDisplayName({ agent: "scout", task: "find things" })).toBe(
      "@scout-1",
    );
  });

  it("S100 C02: socketPath rejects ids that could escape the state directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "s100-state-"));
    const store = new SubagentStore(dir);
    expect(() => store.socketPath("../evil")).toThrow(/Invalid subagent id/);
  });

  it("S100 C03: unknown fields are dropped before state is persisted", () => {
    const dir = mkdtempSync(join(tmpdir(), "s100-state-"));
    const store = new SubagentStore(dir);
    store.write({
      id: "s2",
      status: "running",
      startedAt: 1,
      agent: "scout",
      task: "find",
      depth: 1,
      attempt: 1,
      apiKey: "secret",
    } as never);
    const raw = readFileSync(store.statePath("s2"), "utf8");
    expect(raw).not.toContain("apiKey");
    expect(raw).not.toContain("secret");
  });

  it("S100 C04: update merges patches and updateIf honours its predicate", () => {
    const dir = mkdtempSync(join(tmpdir(), "s100-state-"));
    const store = new SubagentStore(dir);
    store.write({
      id: "s3",
      status: "running",
      startedAt: 1,
      agent: "scout",
      task: "find",
      depth: 1,
      attempt: 1,
    });
    expect(store.update("s3", { status: "completed" })).toMatchObject({
      status: "completed",
      agent: "scout",
    });
    const rejected = store.updateIf(
      "s3",
      (state) => state.status === "running",
      { status: "failed" },
    );
    expect(rejected).toMatchObject({ status: "completed" });
    expect(store.read("s3")?.status).toBe("completed");
  });
});
