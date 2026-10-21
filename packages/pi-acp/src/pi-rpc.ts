import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { LineSplitter } from "./acp.js";

export const SOCKET_ENV = "HOLLOWHEAP_ACP_SOCKET";
export const CAPS_ENV = "HOLLOWHEAP_ACP_CAPS";

export interface PiRpcCallbacks {
  onEvent: (event: unknown) => void;
  onStderr?: (chunk: string) => void;
}

export class PiRpc {
  private pending = new Map<
    number,
    { resolve: (data: unknown) => void; reject: (error: Error) => void }
  >();
  private splitter = new LineSplitter();
  private nextId = 1;

  constructor(
    private writeLine: (line: string) => void,
    private killProc: () => void,
    private callbacks: PiRpcCallbacks,
  ) {}

  static spawn(
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string | undefined> },
    callbacks: PiRpcCallbacks,
  ): PiRpc {
    const proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
    });
    const rpc = new PiRpc(
      (line) => proc.stdin.write(`${line}\n`),
      () => proc.kill(),
      callbacks,
    );
    proc.stdout.on("data", (chunk: Buffer) => rpc.feed(chunk.toString("utf8")));
    proc.stderr.on("data", (chunk: Buffer) => {
      if (callbacks.onStderr) callbacks.onStderr(chunk.toString("utf8"));
      else process.stderr.write(`[pi] ${chunk.toString()}`);
    });
    proc.on("error", (error) => {
      rpc.failAll(error);
      callbacks.onEvent({ type: "proc_error", error: error.message });
    });
    proc.on("exit", (code) => {
      rpc.failAll(new Error(`pi exited with code ${code}`));
    });
    return rpc;
  }

  static fromStreams(
    writeLine: (line: string) => void,
    output: Readable,
    killProc: () => void,
    callbacks: PiRpcCallbacks,
  ): PiRpc {
    const rpc = new PiRpc(writeLine, killProc, callbacks);
    output.on("data", (chunk: Buffer) => rpc.feed(chunk.toString("utf8")));
    return rpc;
  }

  feed(chunk: string): void {
    for (const line of this.splitter.push(chunk)) {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      this.route(message);
    }
  }

  private route(message: unknown): void {
    if (
      typeof message === "object" &&
      message !== null &&
      (message as { type?: unknown }).type === "response" &&
      typeof (message as { id?: unknown }).id === "number" &&
      this.pending.has((message as { id: number }).id)
    ) {
      const id = (message as { id: number }).id;
      const entry = this.pending.get(id);
      this.pending.delete(id);
      const response = message as {
        success?: unknown;
        data?: unknown;
        error?: unknown;
      };
      if (response.success === true) entry?.resolve(response.data);
      else entry?.reject(new Error(String(response.error ?? "pi failed")));
      return;
    }
    this.callbacks.onEvent(message);
  }

  request(
    type: string,
    fields: Record<string, unknown> = {},
  ): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.writeLine(JSON.stringify({ id, type, ...fields }));
    });
  }

  prompt(message: string, images?: unknown[]): Promise<unknown> {
    return this.request(
      "prompt",
      images === undefined ? { message } : { message, images },
    );
  }

  abort(): Promise<unknown> {
    return this.request("abort");
  }

  newSession(): Promise<unknown> {
    return this.request("new_session");
  }

  switchSession(sessionPath: string): Promise<unknown> {
    return this.request("switch_session", { sessionPath });
  }

  getMessages(): Promise<unknown> {
    return this.request("get_messages");
  }

  getState(): Promise<unknown> {
    return this.request("get_state");
  }

  kill(): void {
    this.failAll(new Error("pi killed"));
    this.killProc();
  }

  private failAll(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }
}

export interface SpawnPiRpcOptions {
  cwd: string;
  sessionFile?: string;
  socketPath: string;
  caps: string;
  extensionPath: string;
  appendix: string;
  onEvent: (event: unknown) => void;
}

export function spawnPiRpc(options: SpawnPiRpcOptions): PiRpc {
  const args = [
    "--mode",
    "rpc",
    "--no-themes",
    "-ne",
    "-e",
    options.extensionPath,
    "--append-system-prompt",
    options.appendix,
  ];
  if (options.sessionFile !== undefined) {
    args.push("--session", options.sessionFile);
  }
  return PiRpc.spawn(
    "pi",
    args,
    {
      cwd: options.cwd,
      env: {
        HOLLOWHEAP_ACP_SOCKET: options.socketPath,
        HOLLOWHEAP_ACP_CAPS: options.caps,
      },
    },
    { onEvent: options.onEvent },
  );
}
