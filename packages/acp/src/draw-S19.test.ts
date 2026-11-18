import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  permissionOptions,
  requestPermission,
  requestPermissionOutcome,
  withTimeout,
} from "./client-requests.js";
import {
  RequestTracker,
  attachWireHandler,
  encodeWire,
  sendWireRequest,
} from "./socket.js";

describe("S19: permission identity and bounded RPCs", () => {
  it("carries the pi tool-call id and removes a timed-out pending entry", async () => {
    const calls: { method: string; params: unknown }[] = [];
    const client = async (method: string, params: unknown) => {
      calls.push({ method, params });
      return { outcome: { outcome: "selected", optionId: "allow_once" } };
    };
    await expect(
      requestPermission(client, "session-1", {
        toolCallId: "tool-call-42",
        title: "read x",
        kind: "read",
      }),
    ).resolves.toBe("allow_once");
    expect(calls[0].method).toBe("session/request_permission");
    const params = calls[0].params as {
      sessionId: string;
      toolCall: { toolCallId: string };
    };
    expect(params.sessionId).toBe("session-1");
    expect(params.toolCall.toolCallId).toBe("tool-call-42");

    const tracker = new RequestTracker();
    const socket = { write: () => {} };
    const pending = sendWireRequest(
      socket as never,
      tracker,
      "slow-method",
      {},
      5,
    );
    await expect(pending).rejects.toThrow("slow-method timed out");
    expect(tracker.size).toBe(0);
  });
});

describe("S19: permission options, failure outcomes and wire round trip", () => {
  it("S19 C02: rejection outcomes and the offered options are preserved", async () => {
    expect(permissionOptions().map((option) => option.optionId)).toEqual([
      "allow_once",
      "reject_once",
    ]);
    const calls: { method: string; params: unknown }[] = [];
    const client = async (method: string, params: unknown) => {
      calls.push({ method, params });
      return { outcome: { outcome: "selected", optionId: "reject_once" } };
    };
    await expect(
      requestPermission(client, "session-1", {
        toolCallId: "id-2",
        title: "edit x",
        kind: "edit",
      }),
    ).resolves.toBe("reject_once");
    expect(calls).toHaveLength(1);
  });

  it("S19 C03: a cancelled result and a slow request both fail", async () => {
    expect(() =>
      requestPermissionOutcome({ outcome: { outcome: "cancelled" } }),
    ).toThrow("permission request was cancelled");
    await expect(withTimeout(new Promise(() => {}), "slow", 5)).rejects.toThrow(
      "slow timed out",
    );
  });

  it("S19 C04: the wire handler answers requests and settles tracked responses", async () => {
    const written: string[] = [];
    const socket = new EventEmitter() as EventEmitter & {
      write: (line: string) => void;
    };
    socket.write = (line) => {
      written.push(line);
    };
    const tracker = new RequestTracker();
    const detach = attachWireHandler(
      socket as never,
      tracker,
      (request, respond) => {
        if (request.method === "echo") respond(request.params);
      },
    );

    socket.emit(
      "data",
      Buffer.from(encodeWire({ id: 7, method: "echo", params: "value" })),
    );
    expect(JSON.parse(written[0])).toEqual({ id: 7, result: "value" });

    const pending = sendWireRequest(socket as never, tracker, "echo", "x", 50);
    const requestLine = written[written.length - 1];
    socket.emit("data", Buffer.from(encodeWire({ id: 1, result: "ok" })));
    await expect(pending).resolves.toBe("ok");
    expect(JSON.parse(requestLine)).toEqual({
      id: 1,
      method: "echo",
      params: "x",
    });
    expect(tracker.size).toBe(0);
    detach();
  });
});
