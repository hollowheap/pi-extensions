import { describe, expect, it } from "vitest";
import { requestPermission } from "./client-requests.js";
import { RequestTracker, sendWireRequest } from "./socket.js";

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
