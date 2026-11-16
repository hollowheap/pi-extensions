import { type Socket, createConnection } from "node:net";
import {
  RequestTracker,
  type WireRequest,
  attachWireHandler,
  sendWireRequest,
} from "../socket.js";

export const SOCKET_ENV = "HOLLOWHEAP_ACP_SOCKET";
export const CAPS_ENV = "HOLLOWHEAP_ACP_CAPS";
export const REQUEST_TIMEOUT_MS = 10_000;

export interface FsCaps {
  readTextFile?: boolean;
  writeTextFile?: boolean;
}

export interface ClientCaps {
  fs?: FsCaps;
  terminal?: boolean;
}

export function readCaps(): ClientCaps {
  const raw = process.env[CAPS_ENV];
  if (raw === undefined || raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as ClientCaps;
  } catch {
    return {};
  }
}

export interface SocketClient {
  request(
    method: string,
    params: unknown,
    timeoutMs?: number,
  ): Promise<unknown>;
  close(): void;
}

export function connectSocket(
  socketPath: string,
  onRequest: (request: WireRequest, respond: (result: unknown) => void) => void,
): Promise<SocketClient> {
  const tracker = new RequestTracker();
  return new Promise((resolve, reject) => {
    const sock: Socket = createConnection(socketPath, () => {
      const detach = attachWireHandler(sock, tracker, onRequest);
      resolve({
        request: (method, params, timeoutMs) =>
          sendWireRequest(sock, tracker, method, params, timeoutMs),
        close: () => {
          detach();
          tracker.rejectAll(new Error("socket closed"));
          sock.destroy();
        },
      });
    });
    sock.on("error", reject);
  });
}
