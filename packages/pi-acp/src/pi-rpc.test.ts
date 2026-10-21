import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { PiRpc } from "./pi-rpc.js";

function setup(onEvent: (event: unknown) => void = () => {}): {
  rpc: PiRpc;
  sent: string[];
  peer: PassThrough;
  killed: { value: boolean };
} {
  const sent: string[] = [];
  const peer = new PassThrough();
  const killed = { value: false };
  const rpc = PiRpc.fromStreams(
    (line) => sent.push(line),
    peer,
    () => {
      killed.value = true;
    },
    { onEvent },
  );
  return { rpc, sent, peer, killed };
}

function answer(
  peer: PassThrough,
  sent: string[],
  data: unknown,
  success = true,
): void {
  const command = JSON.parse(sent[sent.length - 1]) as {
    id: number;
    type: string;
  };
  peer.emit(
    "data",
    Buffer.from(
      `${JSON.stringify({ id: command.id, type: "response", command: command.type, success, data, error: success ? undefined : data })}\n`,
    ),
  );
}

describe("pi rpc", () => {
  it("resolves requests with response data", async () => {
    const { rpc, sent, peer } = setup();
    const pending = rpc.request("get_state");
    answer(peer, sent, { sessionId: "abc" });
    await expect(pending).resolves.toEqual({ sessionId: "abc" });
    expect(JSON.parse(sent[0])).toMatchObject({ type: "get_state" });
  });

  it("rejects failed responses", async () => {
    const { rpc, sent, peer } = setup();
    const pending = rpc.request("prompt", { message: "hi" });
    answer(peer, sent, "nope", false);
    await expect(pending).rejects.toThrow("nope");
  });

  it("routes events to the event handler", async () => {
    const events: unknown[] = [];
    const { peer } = setup((event) => events.push(event));
    peer.emit(
      "data",
      Buffer.from('{"type":"agent_settled","aborted":false}\n'),
    );
    peer.emit("data", Buffer.from('{"type":"extension_ui_request","id":9}\n'));
    expect(events).toEqual([
      { type: "agent_settled", aborted: false },
      { type: "extension_ui_request", id: 9 },
    ]);
  });

  it("rejects pending on kill", async () => {
    const { rpc, killed } = setup();
    const pending = rpc.request("prompt", { message: "hi" });
    rpc.kill();
    await expect(pending).rejects.toThrow("pi killed");
    expect(killed.value).toBe(true);
  });

  it("ignores malformed lines", async () => {
    const events: unknown[] = [];
    const { rpc, sent, peer } = setup((event) => events.push(event));
    peer.emit("data", Buffer.from("garbage\n"));
    const pending = rpc.request("get_state");
    answer(peer, sent, {});
    await expect(pending).resolves.toEqual({});
    expect(events).toEqual([]);
  });

  it("sends prompt and abort commands", async () => {
    const { rpc, sent, peer } = setup();
    const prompting = rpc.prompt("hello");
    answer(peer, sent, { disposition: "ok" });
    await expect(prompting).resolves.toEqual({ disposition: "ok" });
    const aborting = rpc.abort();
    answer(peer, sent, {});
    await expect(aborting).resolves.toEqual({});
    expect(
      sent.map((line) => (JSON.parse(line) as { type: string }).type),
    ).toEqual(["prompt", "abort"]);
  });
});
