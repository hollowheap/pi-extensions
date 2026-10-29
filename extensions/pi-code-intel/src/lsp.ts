import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const STDERR_LIMIT = 4_096;
const SHUTDOWN_GRACE_MS = 250;
const MAX_CACHE_ENTRIES = 32;

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspClientOptions {
  name: string;
  command: string;
  args: readonly string[];
  root: string;
  timeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface OpenDocument {
  version: number;
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.max(Math.trunc(value), 1), MAX_TIMEOUT_MS);
}

function encodeMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"),
    body,
  ]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class LspClient {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly root: string;
  readonly timeoutMs: number;

  private child: ChildProcessWithoutNullStreams | undefined;
  private startPromise: Promise<void> | undefined;
  private stdout = Buffer.alloc(0);
  private stderr = "";
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly documents = new Map<string, OpenDocument>();
  private initPromise: Promise<void> | undefined;
  private initialized = false;
  private closed = false;
  private stopping = false;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly onExit: (client: LspClient) => void;

  constructor(options: LspClientOptions, onExit?: (client: LspClient) => void) {
    this.name = options.name;
    this.command = options.command;
    this.args = [...options.args];
    this.root = options.root;
    this.timeoutMs = resolveTimeout(options.timeoutMs);
    this.onExit = onExit ?? (() => undefined);
  }

  get disposed(): boolean {
    return this.closed;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  definition(
    filePath: string,
    languageId: string,
    position: LspPosition,
  ): Promise<unknown> {
    return this.enqueue(async () => {
      await this.ensureInitialized();
      const uri = this.syncDocument(filePath, languageId);
      return this.request("textDocument/definition", {
        textDocument: { uri },
        position,
      });
    });
  }

  references(
    filePath: string,
    languageId: string,
    position: LspPosition,
  ): Promise<unknown> {
    return this.enqueue(async () => {
      await this.ensureInitialized();
      const uri = this.syncDocument(filePath, languageId);
      return this.request("textDocument/references", {
        textDocument: { uri },
        position,
        context: { includeDeclaration: true },
      });
    });
  }

  documentSymbols(filePath: string, languageId: string): Promise<unknown> {
    return this.enqueue(async () => {
      await this.ensureInitialized();
      const uri = this.syncDocument(filePath, languageId);
      return this.request("textDocument/documentSymbol", {
        textDocument: { uri },
      });
    });
  }

  workspaceSymbols(query: string): Promise<unknown> {
    return this.enqueue(async () => {
      await this.ensureInitialized();
      return this.request("workspace/symbol", { query });
    });
  }

  hover(
    filePath: string,
    languageId: string,
    position: LspPosition,
  ): Promise<unknown> {
    return this.enqueue(async () => {
      await this.ensureInitialized();
      const uri = this.syncDocument(filePath, languageId);
      return this.request("textDocument/hover", {
        textDocument: { uri },
        position,
      });
    });
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopping = true;

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(this.describe("client disposed")));
    }
    this.pending.clear();

    const child = this.child;
    const wasInitialized = this.initialized;
    this.child = undefined;
    this.startPromise = undefined;
    this.initialized = false;
    this.initPromise = undefined;
    this.documents.clear();
    if (child === undefined) {
      this.onExit(this);
      return;
    }

    if (wasInitialized && !child.stdin.destroyed) {
      try {
        child.stdin.write(
          encodeMessage({
            jsonrpc: "2.0",
            id: this.nextId++,
            method: "shutdown",
          }),
        );
        child.stdin.write(encodeMessage({ jsonrpc: "2.0", method: "exit" }));
      } catch {
        // The process may already be gone.
      }
    }

    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
    });
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS)),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([
        exited,
        new Promise<void>((resolve) => setTimeout(resolve, 100)),
      ]);
    }
    this.onExit(this);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise !== undefined) return this.initPromise;
    this.initPromise = this.initialize().catch((error) => {
      this.initPromise = undefined;
      this.fail(error);
      throw error;
    });
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    await this.start();
    const rootUri = pathToFileURL(this.root).href;
    await this.request(
      "initialize",
      {
        processId: process.pid,
        clientInfo: { name: "pi-code-intel", version: "0.2.0" },
        rootUri,
        workspaceFolders: [
          { uri: rootUri, name: basename(this.root) || this.root },
        ],
        capabilities: {
          workspace: { symbol: {} },
          textDocument: {
            definition: { linkSupport: true },
            references: {},
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          },
        },
      },
      this.timeoutMs,
    );
    this.initialized = true;
    this.sendNotification("initialized", {});
  }

  private async start(): Promise<void> {
    if (this.closed) {
      throw new Error(this.describe("client is disposed"));
    }
    if (this.child !== undefined) {
      if (this.startPromise !== undefined) await this.startPromise;
      return;
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.command, [...this.args], {
        cwd: this.root,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
    } catch (error) {
      const failure = new Error(
        this.describe(`failed to start: ${errorMessage(error)}`),
      );
      this.fail(failure);
      throw failure;
    }
    this.child = child;
    this.startPromise = new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const cleanup = (): void => {
        child.off("spawn", onSpawn);
        child.off("error", onError);
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
    }).catch((error) => {
      this.child = undefined;
      this.startPromise = undefined;
      const failure = new Error(
        this.describe(`failed to start: ${errorMessage(error)}`),
      );
      this.fail(failure);
      throw failure;
    });

    child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(
        -STDERR_LIMIT,
      );
    });
    child.on("error", (error) => {
      this.fail(
        new Error(this.describe(`failed to start: ${errorMessage(error)}`)),
      );
    });
    child.on("exit", (code, signal) => {
      if (this.stopping) return;
      const detail =
        code !== null ? `exited with code ${code}` : `exited on ${signal}`;
      this.fail(new Error(this.describe(detail)));
    });

    await this.startPromise;
  }

  private request(
    method: string,
    params: unknown,
    timeoutMs = this.timeoutMs,
  ): Promise<unknown> {
    if (this.closed || this.child === undefined) {
      return Promise.reject(new Error(this.describe("client is not running")));
    }
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(
          this.describe(`${method} timed out after ${timeoutMs}ms`),
        );
        this.fail(error);
        reject(error);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child?.stdin.write(
          encodeMessage({ jsonrpc: "2.0", id, method, params }),
        );
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        const failure = new Error(
          this.describe(`failed to write request: ${errorMessage(error)}`),
        );
        this.fail(failure);
        reject(failure);
      }
    });
  }

  private sendNotification(method: string, params: unknown): void {
    if (this.child === undefined) {
      throw new Error(this.describe("client is not running"));
    }
    try {
      this.child.stdin.write(encodeMessage({ jsonrpc: "2.0", method, params }));
    } catch (error) {
      const failure = new Error(
        this.describe(`failed to write notification: ${errorMessage(error)}`),
      );
      this.fail(failure);
      throw failure;
    }
  }

  private sendResponse(id: number | string, result: unknown): void {
    if (this.child === undefined) return;
    try {
      this.child.stdin.write(encodeMessage({ jsonrpc: "2.0", id, result }));
    } catch (error) {
      this.fail(
        new Error(
          this.describe(`failed to write response: ${errorMessage(error)}`),
        ),
      );
    }
  }

  private syncDocument(filePath: string, languageId: string): string {
    let text: string;
    try {
      text = readFileSync(filePath, "utf8");
    } catch (error) {
      throw new Error(
        this.describe(`cannot read ${filePath}: ${errorMessage(error)}`),
      );
    }

    const uri = pathToFileURL(filePath).href;
    const existing = this.documents.get(uri);
    if (existing === undefined) {
      this.documents.set(uri, { version: 1, text });
      this.sendNotification("textDocument/didOpen", {
        textDocument: { uri, languageId, version: 1, text },
      });
    } else if (existing.text !== text) {
      const version = existing.version + 1;
      this.documents.set(uri, { version, text });
      this.sendNotification("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    }
    return uri;
  }

  private onData(chunk: Buffer): void {
    this.stdout = Buffer.concat([this.stdout, chunk]);
    while (true) {
      const headerEnd = this.stdout.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.stdout.subarray(0, headerEnd).toString("ascii");
      const match = /(?:^|\r\n)content-length:\s*(\d+)/i.exec(header);
      if (match === null) {
        this.fail(
          new Error(this.describe("invalid frame: missing Content-Length")),
        );
        return;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.stdout.length < bodyStart + length) return;
      const body = this.stdout
        .subarray(bodyStart, bodyStart + length)
        .toString("utf8");
      this.stdout = this.stdout.subarray(bodyStart + length);
      let message: unknown;
      try {
        message = JSON.parse(body);
      } catch {
        this.fail(new Error(this.describe("invalid JSON from server")));
        return;
      }
      this.handleMessage(message);
    }
  }

  private handleMessage(message: unknown): void {
    if (!isRecord(message)) return;
    const method =
      typeof message.method === "string" ? message.method : undefined;
    const id = message.id;

    if (method === undefined) {
      if (typeof id !== "number") return;
      const pending = this.pending.get(id);
      if (pending === undefined) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if (isRecord(message.error)) {
        const text =
          typeof message.error.message === "string"
            ? message.error.message
            : "unknown error";
        pending.reject(new Error(this.describe(text)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof id === "number" || typeof id === "string") {
      this.answerServerRequest(id, method, message.params);
    }
  }

  private answerServerRequest(
    id: number | string,
    method: string,
    params: unknown,
  ): void {
    let result: unknown = null;
    if (method === "workspace/configuration") {
      const items =
        isRecord(params) && Array.isArray(params.items) ? params.items : [];
      result = items.map(() => null);
    }
    this.sendResponse(id, result);
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.stopping = true;
    const child = this.child;
    this.child = undefined;
    this.startPromise = undefined;
    this.initialized = false;
    this.initPromise = undefined;
    this.documents.clear();

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();

    if (child !== undefined && child.exitCode === null) child.kill();
    this.onExit(this);
  }

  private describe(message: string): string {
    const tail = this.stderr.trim();
    return tail === ""
      ? `${this.name}: ${message}`
      : `${this.name}: ${message}\n${tail}`;
  }
}

const POOL_KEY = Symbol.for("@hollowheap/pi-code-intel/servers");

type ClientPool = Map<string, LspClient>;

function getPool(): ClientPool {
  const store = globalThis as unknown as Record<symbol, ClientPool | undefined>;
  const existing = store[POOL_KEY];
  if (existing !== undefined) return existing;
  const created: ClientPool = new Map();
  store[POOL_KEY] = created;
  return created;
}

function poolKey(options: LspClientOptions): string {
  return `${options.command}\0${options.args.join("\0")}\0${options.root}`;
}

export function getLspClient(options: LspClientOptions): LspClient {
  const pool = getPool();
  const key = poolKey(options);
  const existing = pool.get(key);
  if (existing !== undefined && !existing.disposed) return existing;

  const client = new LspClient(options, (exited) => {
    if (pool.get(key) === exited) pool.delete(key);
  });
  pool.set(key, client);
  if (pool.size > MAX_CACHE_ENTRIES) {
    const oldestKey = pool.keys().next().value;
    if (oldestKey !== undefined && oldestKey !== key) {
      const oldest = pool.get(oldestKey);
      pool.delete(oldestKey);
      void oldest?.dispose();
    }
  }
  return client;
}

export async function disposeAllLspClients(): Promise<void> {
  const pool = getPool();
  const clients = [...pool.values()];
  pool.clear();
  await Promise.all(clients.map((client) => client.dispose()));
}
