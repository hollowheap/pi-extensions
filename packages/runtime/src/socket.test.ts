import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type JsonlServer, requestJsonl, startJsonlServer } from "./index.js";

const dirs: string[] = [];
const servers: JsonlServer[] = [];

function socketPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "hollowheap-socket-"));
  dirs.push(dir);
  return join(dir, "control.sock");
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("JSONL socket", () => {
  it("serves requests and makes the socket private", async () => {
    const path = socketPath();
    const server = await startJsonlServer(path, (request) => ({
      action: request.action,
      payload: request.payload,
    }));
    servers.push(server);

    expect(statSync(path).mode & 0o777).toBe(0o600);
    await expect(
      requestJsonl(path, { id: 1, action: "ping", payload: { x: 1 } }),
    ).resolves.toEqual({ action: "ping", payload: { x: 1 } });
  });

  it("correlates concurrent requests and reports handler errors", async () => {
    const path = socketPath();
    const server = await startJsonlServer(path, async (request) => {
      if (request.action === "fail") throw new Error("boom");
      return `${request.action}:${String(request.payload)}`;
    });
    servers.push(server);

    const [first, second] = await Promise.all([
      requestJsonl(path, { id: "a", action: "echo", payload: 1 }),
      requestJsonl(path, { id: "b", action: "echo", payload: 2 }),
    ]);
    expect(first).toBe("echo:1");
    expect(second).toBe("echo:2");
    await expect(requestJsonl(path, { id: 3, action: "fail" })).rejects.toThrow(
      "boom",
    );
  });

  it("rejects a live duplicate server and can restart after close", async () => {
    const path = socketPath();
    const first = await startJsonlServer(path, () => "ok");
    servers.push(first);
    await expect(startJsonlServer(path, () => "again")).rejects.toThrow(
      /already in use/,
    );
    await first.close();
    servers.splice(servers.indexOf(first), 1);

    const second = await startJsonlServer(path, () => "ok");
    servers.push(second);
    await expect(requestJsonl(path, { id: 1, action: "ping" })).resolves.toBe(
      "ok",
    );
  });

  it("removes a stale socket path before listening", async () => {
    const path = socketPath();
    writeFileSync(path, "stale");
    const server = await startJsonlServer(path, () => "fresh");
    servers.push(server);
    await expect(requestJsonl(path, { id: 1, action: "ping" })).resolves.toBe(
      "fresh",
    );
  });

  it("aborts a pending request", async () => {
    const path = socketPath();
    const server = await startJsonlServer(path, () => {
      return new Promise((resolve) => setTimeout(() => resolve("late"), 100));
    });
    servers.push(server);
    const controller = new AbortController();
    controller.abort();
    await expect(
      requestJsonl(
        path,
        { id: 1, action: "slow" },
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/abort/i);
  });
});
