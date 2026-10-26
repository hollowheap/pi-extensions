import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type JsonlServer, startJsonlServer } from "@hollowheap/process";
import { afterEach, describe, expect, it } from "vitest";
import { runnerRequest, waitForRunner } from "./socket.js";
import type { SubagentState } from "./state.js";

const dirs: string[] = [];
const servers: JsonlServer[] = [];

function socketPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-subagents-socket-"));
  dirs.push(dir);
  return join(dir, "runner.sock");
}

function state(path: string): SubagentState {
  return {
    id: "sub-1",
    status: "running",
    agent: "scout",
    task: "test",
    depth: 1,
    attempt: 1,
    startedAt: 1,
    socket: path,
  };
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runner socket", () => {
  it("sends actions to a live runner socket", async () => {
    const path = socketPath();
    const server = await startJsonlServer(path, (request) => ({
      action: request.action,
      payload: request.payload,
    }));
    servers.push(server);

    await expect(
      runnerRequest(state(path), "send", { type: "prompt", message: "hi" }),
    ).resolves.toEqual({
      action: "send",
      payload: { type: "prompt", message: "hi" },
    });
    await expect(waitForRunner(state(path), 500)).resolves.toBeUndefined();
  });

  it("rejects when no socket is recorded", async () => {
    await expect(
      runnerRequest({ ...state(socketPath()), socket: undefined }, "status"),
    ).rejects.toThrow(/no control socket/);
  });

  it("times out waiting for a missing runner", async () => {
    await expect(waitForRunner(state(socketPath()), 50)).rejects.toThrow();
  });
});
