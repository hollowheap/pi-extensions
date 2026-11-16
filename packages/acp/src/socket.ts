import type { Socket } from "node:net";
import { LineSplitter } from "./acp.js";

export interface WireRequest {
  id: number;
  method: string;
  params?: unknown;
}

export interface WireResponse {
  id: number;
  result?: unknown;
  error?: string;
}

export type WireHandler = (
  request: WireRequest,
  respond: (result: unknown) => void,
) => void;

export function encodeWire(value: WireRequest | WireResponse): string {
  return `${JSON.stringify(value)}\n`;
}

export class RequestTracker {
  private next = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  takeId(): number {
    return this.next++;
  }

  add(
    id: number,
    resolve: (value: unknown) => void,
    reject: (error: Error) => void,
  ): void {
    this.pending.set(id, { resolve, reject });
  }

  settle(response: WireResponse): boolean {
    const entry = this.pending.get(response.id);
    if (entry === undefined) return false;
    this.pending.delete(response.id);
    if (response.error !== undefined) {
      entry.reject(new Error(response.error));
    } else {
      entry.resolve(response.result);
    }
    return true;
  }

  rejectAll(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }

  get size(): number {
    return this.pending.size;
  }
}

export function isWireResponse(value: unknown): value is WireResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "number" && record.method === undefined;
}

export function sendWireRequest(
  sock: Socket,
  tracker: RequestTracker,
  method: string,
  params: unknown,
  timeoutMs?: number,
): Promise<unknown> {
  const id = tracker.takeId();
  return new Promise<unknown>((resolve, reject) => {
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            tracker.settle({ id, error: `${method} timed out` });
          }, timeoutMs);
    tracker.add(
      id,
      (value) => {
        if (timer !== undefined) clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (timer !== undefined) clearTimeout(timer);
        reject(error);
      },
    );
    sock.write(encodeWire({ id, method, params }));
  });
}

export function attachWireHandler(
  sock: Socket,
  tracker: RequestTracker,
  onRequest: WireHandler,
): () => void {
  const splitter = new LineSplitter();
  const onData = (chunk: Buffer) => {
    for (const line of splitter.push(chunk.toString("utf8"))) {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      if (isWireResponse(value)) {
        tracker.settle(value);
        continue;
      }
      if (
        typeof value === "object" &&
        value !== null &&
        typeof (value as WireRequest).method === "string"
      ) {
        const request = value as WireRequest;
        onRequest(request, (result) => {
          sock.write(encodeWire({ id: request.id, result }));
        });
      }
    }
  };
  const onClose = () => {
    tracker.rejectAll(new Error("socket closed"));
  };
  sock.on("data", onData);
  sock.on("close", onClose);
  sock.on("error", () => {});
  return () => {
    sock.off("data", onData);
    sock.off("close", onClose);
  };
}
