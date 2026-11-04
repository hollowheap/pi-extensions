import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { type Socket, createConnection, createServer } from "node:net";
import { dirname } from "node:path";

export interface JsonlRequest {
  id: string | number;
  action: string;
  payload?: unknown;
}

export interface JsonlResponse {
  id: string | number | null;
  ok: boolean;
  payload?: unknown;
  error?: string;
}

export type JsonlHandler = (
  request: JsonlRequest,
) => Promise<unknown> | unknown;

export interface JsonlServer {
  path: string;
  close: () => Promise<void>;
}

export interface JsonlServerOptions {
  maxLineBytes?: number;
}

export interface JsonlRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  maxLineBytes?: number;
}

const DEFAULT_MAX_LINE_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequest(value: unknown): value is JsonlRequest {
  return (
    isRecord(value) &&
    (typeof value.id === "string" || typeof value.id === "number") &&
    typeof value.action === "string"
  );
}

function send(socket: Socket, response: JsonlResponse): void {
  if (socket.destroyed) return;
  socket.write(`${JSON.stringify(response)}\n`);
}

function canConnect(path: string, timeoutMs = 200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function prepareSocketPath(path: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (!existsSync(path)) return;
  if (await canConnect(path)) {
    throw new Error(`socket already in use: ${path}`);
  }
  try {
    unlinkSync(path);
  } catch {
    // Another owner may have removed it.
  }
}

export async function startJsonlServer(
  path: string,
  handler: JsonlHandler,
  options: JsonlServerOptions = {},
): Promise<JsonlServer> {
  await prepareSocketPath(path);
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > maxLineBytes) {
        send(socket, { id: null, ok: false, error: "request too large" });
        socket.destroy();
        return;
      }
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (line.trim() === "") continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          send(socket, { id: null, ok: false, error: "invalid JSON" });
          continue;
        }
        if (!isRequest(parsed)) {
          send(socket, { id: null, ok: false, error: "invalid request" });
          continue;
        }
        const request = parsed;
        Promise.resolve()
          .then(() => handler(request))
          .then(
            (payload) => send(socket, { id: request.id, ok: true, payload }),
            (error) =>
              send(socket, {
                id: request.id,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }),
          );
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(path);
  });
  chmodSync(path, 0o600);
  server.on("error", () => {});

  return {
    path,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        unlinkSync(path);
      } catch {
        // Already removed.
      }
    },
  };
}

export function requestJsonl(
  path: string,
  request: JsonlRequest,
  options: JsonlRequestOptions = {},
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException("socket request aborted", "AbortError"));
      return;
    }
    const socket = createConnection(path);
    let settled = false;
    let buffer = "";
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      fn();
    };
    const onAbort = () => {
      finish(() =>
        reject(new DOMException("socket request aborted", "AbortError")),
      );
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error("socket request timed out")));
    }, timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });

    socket.setEncoding("utf8");
    socket.on("error", (error) => finish(() => reject(error)));
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > maxLineBytes) {
        finish(() => reject(new Error("socket response too large")));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        finish(() => reject(new Error("invalid socket response")));
        return;
      }
      if (!isRecord(parsed) || parsed.id !== request.id) {
        finish(() => reject(new Error("socket response id mismatch")));
        return;
      }
      if (parsed.ok !== true) {
        finish(() =>
          reject(
            new Error(
              typeof parsed.error === "string"
                ? parsed.error
                : "socket request failed",
            ),
          ),
        );
        return;
      }
      finish(() => resolve(parsed.payload));
    });
    socket.on("close", () => {
      finish(() => reject(new Error("socket closed before response")));
    });
  });
}
