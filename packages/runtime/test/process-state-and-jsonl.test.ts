import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requestJsonl, startJsonlServer } from "../src/socket.js";
import { ProcessStore } from "../src/state.js";

describe("permissioned process state and JSONL transport", () => {
  it("writes atomic 0600 state and 0600 sockets with correlated frames", async () => {
    const dir = mkdtempSync(join(tmpdir(), "process-state-and-jsonl-runtime-"));
    const store = new ProcessStore(join(dir, "state"));
    store.write({ id: "p1", status: "running", startedAt: 1 });
    expect(statSync(store.statePath("p1")).mode & 0o777).toBe(0o600);
    expect(readdirSync(store.dir).some((name) => name.endsWith(".tmp"))).toBe(
      false,
    );

    const socketPath = join(dir, "sockets", "c.sock");
    const server = await startJsonlServer(socketPath, (req) => ({
      echo: req.id,
    }));
    try {
      expect(statSync(socketPath).mode & 0o777).toBe(0o600);
      expect(
        await requestJsonl(socketPath, { id: "x", action: "ping" }),
      ).toEqual({ echo: "x" });
    } finally {
      await server.close();
    }
  });

  it("state path helpers reject ids that could escape the directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "process-state-and-jsonl-runtime-"));
    const store = new ProcessStore(dir);
    expect(() => store.statePath("../escape")).toThrow(/Invalid process id/);
  });

  it("corrupt or missing state reads are ignored", () => {
    const dir = mkdtempSync(join(tmpdir(), "process-state-and-jsonl-runtime-"));
    const store = new ProcessStore(dir);
    writeFileSync(join(store.dir, "broken.json"), "not json");
    expect(store.read("broken")).toBeUndefined();
    expect(store.read("missing")).toBeUndefined();
  });

  it("list sorts by start time and update merges patches", () => {
    const dir = mkdtempSync(join(tmpdir(), "process-state-and-jsonl-runtime-"));
    const store = new ProcessStore(dir);
    store.write({ id: "b", status: "running", startedAt: 2 });
    store.write({ id: "a", status: "running", startedAt: 1 });
    expect(store.list().map((state) => state.id)).toEqual(["a", "b"]);
    expect(store.update("a", { status: "done" })).toMatchObject({
      id: "a",
      status: "done",
    });
    expect(store.read("a")?.status).toBe("done");
  });
});
