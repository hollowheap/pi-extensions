import { existsSync, mkdtempSync } from "node:fs";
import { type Socket, createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Adapter, type SpawnPi, type SpawnPiOptions } from "./adapter.js";
import { RequestTracker, attachWireHandler } from "./socket.js";

const peers: Socket[] = [];
const live: Adapter[] = [];

function setup(stateOverride: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "draw-s18-"));
  const storePath = join(dir, "sessions.json");
  const spawns: SpawnPiOptions[] = [];
  const calls: string[][] = [];
  const state: Record<string, unknown> = {
    sessionFile: join(dir, "pi-session.jsonl"),
    sessionId: "pi-1",
    ...stateOverride,
  };
  const spawnPi: SpawnPi = (opts) => {
    spawns.push(opts);
    const current: string[] = [];
    calls.push(current);
    const peer = createConnection(opts.socketPath);
    peers.push(peer);
    peer.on("error", () => {});
    peer.on("connect", () => {
      attachWireHandler(peer, new RequestTracker(), (request, respond) => {
        if (request.method === "get-modes") {
          respond({ modes: [{ name: "plan" }, { name: "manual" }] });
          return;
        }
        respond({ modes: [{ name: "plan" }, { name: "manual" }], notices: [] });
      });
    });
    return {
      request: async (type: string) => {
        current.push(type);
        if (type === "new_session") return { cancelled: false };
        throw new Error(`unexpected: ${type}`);
      },
      getState: async () => ({ ...state }),
      getAvailableModels: async () => ({ models: [] }),
      setModel: async () => state.model,
      getMessages: async () => ({ messages: [] }),
      abort: async () => {
        current.push("abort");
        return {};
      },
      kill: () => {
        current.push("kill");
      },
      prompt: async () => {
        current.push("prompt");
      },
    } as never;
  };
  const adapter = new Adapter({
    spawnPi,
    extensionPath: "/ext/index.ts",
    storePath,
    notify: () => {},
    client: async () => {
      throw new Error("no client");
    },
    log: () => {},
  });
  live.push(adapter);
  return { adapter, spawns, calls };
}

afterEach(async () => {
  await Promise.all(live.splice(0).map((adapter) => adapter.shutdown()));
  for (const peer of peers.splice(0)) peer.destroy();
});

describe("S18: adapter lifecycle and prompt dispatch", () => {
  it("tears down prior sessions and rejects pending work on close", async () => {
    const reloaded = setup();
    await reloaded.adapter.handle("session/new", { cwd: "/repo" });
    await reloaded.adapter.handle("session/load", {
      sessionId: "pi-1",
      cwd: "/repo",
    });
    expect(reloaded.spawns).toHaveLength(2);
    expect(reloaded.calls[0]).toContain("kill");

    const failed = setup({ sessionId: undefined });
    await expect(
      failed.adapter.handle("session/new", { cwd: "/repo" }),
    ).rejects.toThrow("did not report a session");
    expect(existsSync(failed.spawns[0].socketPath)).toBe(false);

    const closed = setup();
    await closed.adapter.handle("session/new", { cwd: "/repo" });
    const pending = closed.adapter.handle("session/prompt", {
      sessionId: "pi-1",
      prompt: [{ type: "text", text: "hello" }],
    });
    closed.adapter.piEvent("pi-1", { type: "agent_settled", aborted: false });
    await expect(pending).resolves.toEqual({ stopReason: "end_turn" });

    const shutting = setup();
    await shutting.adapter.handle("session/new", { cwd: "/repo" });
    const inFlight = shutting.adapter.handle("session/prompt", {
      sessionId: "pi-1",
      prompt: [{ type: "text", text: "hello" }],
    });
    await shutting.adapter.shutdown();
    await expect(inFlight).rejects.toThrow("session closed");
  });
});
