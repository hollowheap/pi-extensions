import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  LineSplitter,
  decodeLine,
  encodeMessage,
  isNotification,
  isRequest,
} from "./acp.js";
import { Adapter } from "./adapter.js";
import { main } from "./main.js";

describe("acp framing", () => {
  it("round-trips a request through encode and decode", () => {
    const message = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: 1 },
    };
    expect(decodeLine(encodeMessage(message).trim())).toEqual(message);
  });

  it("throws on bad JSON", () => {
    expect(() => decodeLine("Content-Length: 5")).toThrow();
  });

  it("recognizes requests and notifications", () => {
    expect(isRequest({ jsonrpc: "2.0", id: 1, method: "initialize" })).toBe(
      true,
    );
    expect(isRequest({ jsonrpc: "2.0", method: "ping" })).toBe(false);
    expect(isRequest(null)).toBe(false);
    expect(
      isNotification({
        jsonrpc: "2.0",
        method: "session/cancel",
        params: { sessionId: "s-1" },
      }),
    ).toBe(true);
    expect(
      isNotification({ jsonrpc: "2.0", id: 1, method: "session/cancel" }),
    ).toBe(false);
  });

  it("routes a session/cancel notification without id to the adapter without replying", async () => {
    const handleSpy = vi
      .spyOn(Adapter.prototype, "handle")
      .mockResolvedValue({});
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
    try {
      await main(input, output, []);
      input.write(
        encodeMessage({
          jsonrpc: "2.0",
          method: "session/cancel",
          params: { sessionId: "s-1" },
        }),
      );
      await new Promise((r) => setTimeout(r, 30));
      expect(handleSpy).toHaveBeenCalledWith("session/cancel", {
        sessionId: "s-1",
      });
      expect(chunks.join("")).toBe("");
    } finally {
      handleSpy.mockRestore();
      process.removeAllListeners("SIGTERM");
      process.removeAllListeners("SIGINT");
    }
  });

  it("splits partial chunks into whole lines", () => {
    const splitter = new LineSplitter();
    expect(splitter.push('{"a":1}\n{"b')).toEqual(['{"a":1}']);
    expect(splitter.push('":2}\n\n{"c":3}\n')).toEqual(['{"b":2}', '{"c":3}']);
    expect(splitter.push('{"d":')).toEqual([]);
  });
});
