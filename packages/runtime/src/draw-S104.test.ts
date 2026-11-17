import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requestJsonl, startJsonlServer } from "./socket.js";
import { ProcessStore } from "./state.js";

describe("S104 permissioned process state and JSONL transport", () => {
  it("writes atomic 0600 state and 0600 sockets with correlated frames", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s104-runtime-"));
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
});
