export interface RpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface RpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: RpcError;
}

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

export function encodeMessage(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function decodeLine(line: string): unknown {
  return JSON.parse(line);
}

export function isRequest(value: unknown): value is RpcRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.jsonrpc === "2.0" &&
    (typeof record.id === "number" || typeof record.id === "string") &&
    typeof record.method === "string"
  );
}

export class LineSplitter {
  private rest = "";

  push(chunk: string): string[] {
    this.rest += chunk;
    const lines: string[] = [];
    let index = this.rest.indexOf("\n");
    while (index >= 0) {
      const line = this.rest.slice(0, index).trim();
      if (line !== "") lines.push(line);
      this.rest = this.rest.slice(index + 1);
      index = this.rest.indexOf("\n");
    }
    return lines;
  }
}
