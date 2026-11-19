import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage } from "@hollowheap/core/format";
import {
  LineSplitter,
  encodeMessage,
  isNotification,
  isRequest,
} from "./acp.js";
import { Adapter } from "./adapter.js";
import type { ClientRequest } from "./client-requests.js";
import { spawnPiRpc } from "./pi-rpc.js";

const SYSTEM_APPENDIX = `ACP session tools: prefer acp_read, acp_write, acp_edit, acp_bash, acp_fd, acp_rg, acp_eza over built-in tools with overlapping jobs.
- acp_write creates new files only and refuses existing paths.
- acp_edit replaces exact oldText matches and refuses when the editor buffer differs from disk.
- Approval modes, switched by the client, not by you: plan allows reads and allowlisted bash and writes only to artifacts/plan.md and artifacts/specs.md (those always ask); manual follows the rules and asks when unlisted; edit runs reads and writes silently and runs only allowlisted bash; auto runs writes and non-destructive bash silently.
- Denied calls stay denied: do not retry them with a different tool.`;

export function storePath(): string {
  const home =
    process.env.HOLLOWHEAP_ACP_HOME ??
    join(homedir(), ".local", "share", "hollowheap-pi-acp");
  return join(home, "sessions.json");
}

export async function finishShutdown(
  shutdown: () => void | Promise<void>,
  exit: (code: number) => void = (code) => process.exit(code),
): Promise<void> {
  await shutdown();
  exit(0);
}

export function attachStdioShutdown(
  input: NodeJS.ReadableStream,
  shutdown: () => void,
  signals: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT"],
): void {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    shutdown();
  };
  input.on("end", once);
  input.on("close", once);
  for (const signal of signals) process.on(signal, once);
}

export function extensionPath(): string {
  const here = fileURLToPath(import.meta.url);
  const entry = here.endsWith(".ts") ? "index.ts" : "index.js";
  return join(dirname(here), "extension", entry);
}

export async function main(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
  argv: string[] = process.argv,
): Promise<void> {
  let defaultModel: string | undefined;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === "--model" || arg === "-m") && i + 1 < argv.length) {
      defaultModel = argv[++i];
    } else if (arg.startsWith("--model=")) {
      defaultModel = arg.slice("--model=".length);
    }
  }

  let nextId = 1;
  const pending = new Map<
    number | string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const write = (value: unknown) => {
    output.write(encodeMessage(value));
  };
  const client: ClientRequest = (method, params, timeoutMs, signal) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }, timeoutMs);
      }
      pending.set(id, {
        resolve: (value) => {
          if (timer !== undefined) clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          if (timer !== undefined) clearTimeout(timer);
          reject(error);
        },
      });
      signal?.addEventListener(
        "abort",
        () => {
          const entry = pending.get(id);
          if (entry === undefined) return;
          pending.delete(id);
          entry.reject(new Error("cancelled"));
        },
        { once: true },
      );
      write({ jsonrpc: "2.0", id, method, params });
    });

  const adapter = new Adapter({
    spawnPi: (opts, onEvent) =>
      spawnPiRpc({
        cwd: opts.cwd,
        sessionFile: opts.sessionFile,
        model: opts.model,
        socketPath: opts.socketPath,
        caps: JSON.stringify(opts.caps),
        extensionPath: opts.extensionPath,
        appendix: SYSTEM_APPENDIX,
        onEvent,
      }),
    extensionPath: extensionPath(),
    storePath: storePath(),
    defaultModel,
    notify: (sessionId, update) => {
      write({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId, update },
      });
    },
    client,
    log: (message) => process.stderr.write(`[pi-acp] ${message}\n`),
  });

  const splitter = new LineSplitter();
  const onLine = (line: string) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      process.stderr.write(
        `[pi-acp] dropping malformed line: ${errorMessage(error)}\n`,
      );
      return;
    }
    if (isRequest(message)) {
      const id = message.id;
      const method = message.method;
      void adapter.handle(method, message.params).then(
        (result) => write({ jsonrpc: "2.0", id, result }),
        (error) =>
          write({
            jsonrpc: "2.0",
            id,
            error: {
              code:
                typeof (error as { code?: unknown })?.code === "number"
                  ? (error as { code: number }).code
                  : -32603,
              message: errorMessage(error),
            },
          }),
      );
      return;
    }
    if (isNotification(message)) {
      void adapter.handle(message.method, message.params).catch((error) => {
        process.stderr.write(
          `[pi-acp] notification ${message.method} failed: ${errorMessage(error)}\n`,
        );
      });
      return;
    }
    if (
      typeof message === "object" &&
      message !== null &&
      (typeof (message as { id?: unknown }).id === "number" ||
        typeof (message as { id?: unknown }).id === "string")
    ) {
      const id = (message as { id: number | string }).id;
      const entry = pending.get(id);
      if (entry === undefined) return;
      pending.delete(id);
      const response = message as {
        result?: unknown;
        error?: { message?: unknown };
      };
      if (response.error !== undefined) {
        entry.reject(
          new Error(
            typeof response.error?.message === "string"
              ? response.error.message
              : "client request failed",
          ),
        );
      } else {
        entry.resolve(response.result);
      }
    }
  };

  input.on("data", (chunk: Buffer) => {
    for (const line of splitter.push(chunk.toString("utf8"))) onLine(line);
  });

  const shutdown = () => {
    void finishShutdown(
      () => adapter.shutdown(),
      (code) => process.exit(code),
    );
  };
  attachStdioShutdown(input, shutdown);
  process.stderr.write(`[pi-acp] listening (tmp: ${tmpdir()})\n`);
}

const invokedAsMain =
  process.argv[1] !== undefined &&
  process.argv[1] === fileURLToPath(import.meta.url);

if (invokedAsMain) {
  main().catch((error) => {
    process.stderr.write(`[pi-acp] fatal: ${errorMessage(error)}\n`);
    process.exit(1);
  });
}
