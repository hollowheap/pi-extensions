import { describe, expect, it } from "vitest";
import { connectSocket, readCaps } from "./client.js";

describe("extension client config", () => {
  it("reads caps from the environment", () => {
    const previous = process.env.HOLLOWHEAP_ACP_CAPS;
    try {
      process.env.HOLLOWHEAP_ACP_CAPS = "";
      expect(readCaps()).toEqual({});
      process.env.HOLLOWHEAP_ACP_CAPS = "not json";
      expect(readCaps()).toEqual({});
      process.env.HOLLOWHEAP_ACP_CAPS = JSON.stringify({
        fs: { readTextFile: true },
        terminal: true,
      });
      expect(readCaps()).toEqual({
        fs: { readTextFile: true },
        terminal: true,
      });
    } finally {
      process.env.HOLLOWHEAP_ACP_CAPS = previous ?? "";
    }
  });

  it("rejects unreachable sockets", async () => {
    await expect(
      connectSocket("/tmp/pi-acp-no-such-socket.sock", () => {}),
    ).rejects.toThrow();
  });
});
