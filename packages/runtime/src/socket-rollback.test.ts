import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type JsonlServer, requestJsonl, startJsonlServer } from "./index.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, chmodSync: vi.fn(actual.chmodSync) };
});

import { chmodSync } from "node:fs";

describe("startJsonlServer post-listen failure", () => {
  const dirs: string[] = [];
  const servers: JsonlServer[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) await server.close();
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rolls back the listening server and socket path when chmod fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-socket-rollback-"));
    dirs.push(dir);
    const path = join(dir, "control.sock");

    vi.mocked(chmodSync).mockImplementationOnce(() => {
      throw new Error("chmod failed");
    });

    await expect(startJsonlServer(path, () => "ok")).rejects.toThrow(
      "chmod failed",
    );
    expect(existsSync(path)).toBe(false);

    const server = await startJsonlServer(path, () => "fresh");
    servers.push(server);
    await expect(requestJsonl(path, { id: 1, action: "ping" })).resolves.toBe(
      "fresh",
    );
  });
});
