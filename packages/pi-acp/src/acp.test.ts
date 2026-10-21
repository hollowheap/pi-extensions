import { describe, expect, it } from "vitest";
import { LineSplitter, decodeLine, encodeMessage, isRequest } from "./acp.js";

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

  it("recognizes requests and rejects notifications", () => {
    expect(isRequest({ jsonrpc: "2.0", id: 1, method: "initialize" })).toBe(
      true,
    );
    expect(isRequest({ jsonrpc: "2.0", method: "ping" })).toBe(false);
    expect(isRequest(null)).toBe(false);
  });

  it("splits partial chunks into whole lines", () => {
    const splitter = new LineSplitter();
    expect(splitter.push('{"a":1}\n{"b')).toEqual(['{"a":1}']);
    expect(splitter.push('":2}\n\n{"c":3}\n')).toEqual(['{"b":2}', '{"c":3}']);
    expect(splitter.push('{"d":')).toEqual([]);
  });
});
