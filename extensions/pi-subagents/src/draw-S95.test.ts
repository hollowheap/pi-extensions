import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requestJsonl, startJsonlServer } from "@hollowheap/runtime/socket";

describe("S95 detached child control socket", () => {
  it("routes a correlated JSONL request to the handler and back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s95-sock-"));
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
});
