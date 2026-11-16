import { mkdtempSync } from "node:fs";
import { type Socket, createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RequestTracker,
  type WireRequest,
  attachWireHandler,
  sendWireRequest,
} from "./socket.js";

type Handler = (
  request: WireRequest,
  respond: (result: unknown) => void,
) => void;

const sockets: Socket[] = [];
const servers: ReturnType<typeof createServer>[] = [];

afterEach(() => {
  for (const sock of sockets.splice(0)) sock.destroy();
  for (const server of servers.splice(0)) server.close();
});

function listen(onRequest: Handler): Promise<{
  path: string;
  tracker: RequestTracker;
  accepted: Socket[];
}> {
  const tracker = new RequestTracker();
  const accepted: Socket[] = [];
  const path = join(mkdtempSync(join(tmpdir(), "pi-acp-sock-")), "s.sock");
  return new Promise((resolve) => {
    const server = createServer((sock) => {
      sockets.push(sock);
      accepted.push(sock);
      attachWireHandler(sock, tracker, onRequest);
    });
    servers.push(server);
    server.listen(path, () => resolve({ path, tracker, accepted }));
  });
}

function connect(
  path: string,
  onRequest: Handler = () => {},
): Promise<{ sock: Socket; tracker: RequestTracker }> {
  const tracker = new RequestTracker();
  return new Promise((resolve, reject) => {
    const sock = createConnection(path, () => {
      sockets.push(sock);
      attachWireHandler(sock, tracker, onRequest);
      resolve({ sock, tracker });
    });
    sock.on("error", reject);
  });
}

describe("socket wire", () => {
  it("answers requests in both directions", async () => {
    const seen: string[] = [];
    const {
      path,
      tracker: serverTracker,
      accepted,
    } = await listen((request, respond) => {
      seen.push(`server:${request.method}`);
      respond(`hi-${request.method}`);
    });
    const { sock, tracker: clientTracker } = await connect(
      path,
      (request, respond) => {
        seen.push(`client:${request.method}`);
        respond(42);
      },
    );
    await expect(
      sendWireRequest(sock, clientTracker, "permission", { a: 1 }, 1000),
    ).resolves.toBe("hi-permission");
    await expect(
      sendWireRequest(accepted[0], serverTracker, "set-mode", {}, 1000),
    ).resolves.toBe(42);
    expect(seen).toEqual(["server:permission", "client:set-mode"]);
    expect(serverTracker.size).toBe(0);
    expect(clientTracker.size).toBe(0);
  });

  it("rejects on timeout", async () => {
    const { path } = await listen(() => {});
    const { sock, tracker } = await connect(path);
    await expect(
      sendWireRequest(sock, tracker, "slow", {}, 30),
    ).rejects.toThrow("slow timed out");
  });

  it("rejects pending on close", async () => {
    const { path } = await listen(() => {});
    const { sock, tracker } = await connect(path);
    const pending = sendWireRequest(sock, tracker, "slow", {}, 1000);
    sock.destroy();
    await expect(pending).rejects.toThrow("socket closed");
  });

  it("ignores malformed lines", async () => {
    const spy = vi.fn();
    const { path } = await listen((request, respond) => {
      spy(request);
      respond(undefined);
    });
    const { sock, tracker } = await connect(path);
    sock.write("not json\n");
    await expect(
      sendWireRequest(sock, tracker, "ok", {}, 1000),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
