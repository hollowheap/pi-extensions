import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SubagentStore, requireTrustedProject, subagentsDir } from "./state.js";

const dirs: string[] = [];

function agentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-subagents-state-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("SubagentStore", () => {
  it("stores allowed state with restrictive permissions", () => {
    const root = agentDir();
    const store = new SubagentStore(root);
    store.write({
      id: "sub-1",
      status: "running",
      agent: "scout",
      task: "find things",
      depth: 1,
      attempt: 1,
      startedAt: 100,
      pid: 123,
      startTime: 456,
      socket: "/tmp/x.sock",
      session: "/tmp/session.jsonl",
      model: "p/m",
    });

    expect(subagentsDir(root)).toBe(join(root, "subagents"));
    expect(store.read("sub-1")).toMatchObject({
      agent: "scout",
      task: "find things",
      depth: 1,
      attempt: 1,
      pid: 123,
      startTime: 456,
      socket: "/tmp/x.sock",
      session: "/tmp/session.jsonl",
      model: "p/m",
    });
    expect(statSync(store.dir).mode & 0o777).toBe(0o700);
    expect(statSync(store.statePath("sub-1")).mode & 0o777).toBe(0o600);
    expect(statSync(store.ensureLog("sub-1")).mode & 0o777).toBe(0o600);
    expect(store.socketPath("sub-1")).toBe(join(store.dir, "sub-1.sock"));
  });

  it("strips secret fields and ignores corrupt state", () => {
    const root = agentDir();
    const store = new SubagentStore(root);
    store.write({
      id: "sub-2",
      status: "running",
      agent: "worker",
      task: "do work",
      depth: 1,
      attempt: 1,
      startedAt: 100,
      apiKey: "secret",
      token: "secret",
      authorization: "Bearer secret",
    } as never);

    const raw = readFileSync(store.statePath("sub-2"), "utf8");
    expect(raw).not.toContain("secret");
    expect(store.read("sub-2")).not.toHaveProperty("apiKey");

    writeFileSync(join(store.dir, "bad.json"), "{", { mode: 0o600 });
    expect(store.read("bad")).toBeUndefined();
  });

  it("lists states in start order", () => {
    const root = agentDir();
    const store = new SubagentStore(root);
    store.write({
      id: "b",
      status: "completed",
      agent: "worker",
      task: "b",
      depth: 1,
      attempt: 1,
      startedAt: 200,
    });
    store.write({
      id: "a",
      status: "running",
      agent: "scout",
      task: "a",
      depth: 1,
      attempt: 1,
      startedAt: 100,
    });
    expect(store.list().map((state) => state.id)).toEqual(["a", "b"]);
  });

  it("requires trust and validates ids", () => {
    expect(() => requireTrustedProject(false)).toThrow(/trusted/);
    expect(() => requireTrustedProject(true)).not.toThrow();
    const store = new SubagentStore(agentDir());
    expect(() => store.socketPath("../escape")).toThrow(/Invalid subagent id/);
    expect(store.log("missing")).toBe("");
  });
});
