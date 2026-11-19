import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestJsonl, startJsonlServer } from "@hollowheap/runtime/socket";
import { describe, expect, it } from "vitest";

describe("detached child control socket", () => {
  it("routes a correlated JSONL request to the handler and back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "child-control-socket-sock-"));
    const server = await startJsonlServer(join(dir, "child.sock"), (req) => ({
      received: req.action,
      id: req.id,
    }));
    try {
      const result = await requestJsonl(server.path, {
        id: 7,
        action: "status",
      });
      expect(result).toEqual({ received: "status", id: 7 });
    } finally {
      await server.close();
    }
  });

  it("rejects a pre-aborted request without connecting", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      requestJsonl(
        join(tmpdir(), "child-control-socket-no-such-socket.sock"),
        { id: 1, action: "status" },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("propagates a handler error to the caller as a rejection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "child-control-socket-sock-"));
    const server = await startJsonlServer(join(dir, "child.sock"), () => {
      throw new Error("handler exploded");
    });
    try {
      await expect(
        requestJsonl(server.path, { id: 2, action: "status" }),
      ).rejects.toThrow("handler exploded");
    } finally {
      await server.close();
    }
  });

  it("correlates concurrent requests by id without cross-talk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "child-control-socket-sock-"));
    const server = await startJsonlServer(join(dir, "child.sock"), (req) => ({
      id: req.id,
      action: req.action,
    }));
    try {
      const [first, second] = await Promise.all([
        requestJsonl(server.path, { id: "a", action: "ping" }),
        requestJsonl(server.path, { id: "b", action: "status" }),
      ]);
      expect(first).toEqual({ id: "a", action: "ping" });
      expect(second).toEqual({ id: "b", action: "status" });
    } finally {
      await server.close();
    }
  });
});
